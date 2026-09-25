package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"gram/gateway/internal/gateway"
	"gram/gateway/internal/tickets"
)

func main() {
	logger := log.New(os.Stdout, "gram-wire ", log.LstdFlags|log.LUTC)
	identity, err := identityFromConfiguration()
	if err != nil {
		logger.Fatal("startup_failed class=identity")
	}
	ticketSecret, err := secretFromConfiguration("WIRE_TICKET_SECRET", 4096)
	if err != nil {
		logger.Fatal("startup_failed class=ticket_configuration")
	}
	ticketValidator, err := tickets.NewValidator(ticketSecret, env("WIRE_TICKET_ISSUER", "gram-api"))
	if err != nil {
		logger.Fatal("startup_failed class=ticket_configuration")
	}
	redisOptions, err := redis.ParseURL(os.Getenv("REDIS_URL"))
	if err != nil {
		logger.Fatal("startup_failed class=redis_configuration")
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	if err := redisClient.Ping(probe).Err(); err != nil {
		cancel()
		logger.Fatal("startup_failed class=redis_unavailable")
	}
	cancel()
	consumer, err := gateway.NewRedisTicketConsumer(redisClient)
	if err != nil {
		logger.Fatal("startup_failed class=redis_configuration")
	}
	events, err := gateway.NewRedisEventStore(redisClient, 10_000, 7*24*time.Hour)
	if err != nil {
		logger.Fatal("startup_failed class=event_configuration")
	}
	internalSecret, err := secretFromConfiguration("WIRE_INTERNAL_SECRET", 4096)
	if err != nil {
		logger.Fatal("startup_failed class=session_configuration")
	}
	sessions, err := gateway.NewHTTPSessionValidator(
		env("WIRE_SESSION_CHECK_URL", "http://api:8000/api/internal/wire/session-check"),
		internalSecret,
	)
	if err != nil {
		logger.Fatal("startup_failed class=session_configuration")
	}
	handler := &gateway.Handler{
		Tickets: ticketValidator, Used: consumer, Events: events, Sessions: sessions,
		RequireChannelBinding: env("WIRE_REQUIRE_CHANNEL_BINDING", "false") == "true",
	}
	origins := splitCSV(env("WIRE_ALLOWED_ORIGINS", "https://vexory.xyz,https://www.vexory.xyz"))
	server, err := gateway.NewServer(
		identity,
		handler,
		origins,
		func(check context.Context) error { return redisClient.Ping(check).Err() },
		logger,
	)
	if err != nil {
		logger.Fatal("startup_failed class=server_configuration")
	}
	// Metrics are optional but never anonymous: an unset token leaves /metrics returning 403.
	metricsToken, configured, err := optionalSecretFromConfiguration("WIRE_METRICS_TOKEN", 4096)
	if err != nil {
		logger.Fatal("startup_failed class=metrics_configuration")
	}
	if configured {
		if err := server.SetMetricsToken(metricsToken); err != nil {
			logger.Fatal("startup_failed class=metrics_configuration")
		}
	}

	tcpListener, err := net.Listen("tcp", env("WIRE_TCP_ADDR", ":5222"))
	if err != nil {
		logger.Fatal("startup_failed class=tcp_listener")
	}
	httpServer := &http.Server{
		Addr:              env("WIRE_HTTP_ADDR", ":4001"),
		Handler:           server.HTTPHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	errorsChannel := make(chan error, 2)
	go func() { errorsChannel <- server.ServeTCP(ctx, tcpListener) }()
	go func() { errorsChannel <- httpServer.ListenAndServe() }()
	logger.Printf("ready protocol=1 identity_fingerprint=%s", server.PublicKeyFingerprint())

	select {
	case <-ctx.Done():
	case err := <-errorsChannel:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Print("runtime_failed class=listener")
		}
		stop()
	}
	shutdown, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdown)
	_ = tcpListener.Close()
}

func identityFromConfiguration() (ed25519.PrivateKey, error) {
	encoded, err := secretFromConfiguration("WIRE_IDENTITY_PRIVATE_KEY_B64", 4096)
	if err != nil {
		return nil, err
	}
	var decoded []byte
	decoders := []*base64.Encoding{
		base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding, base64.URLEncoding,
	}
	for _, decoder := range decoders {
		decoded, err = decoder.DecodeString(encoded)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, errors.New("invalid identity")
	}
	if len(decoded) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(decoded), nil
	}
	if len(decoded) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid identity")
	}
	return ed25519.PrivateKey(decoded), nil
}

func optionalSecretFromConfiguration(name string, maxBytes int64) (string, bool, error) {
	value := strings.TrimSpace(os.Getenv(name))
	path := strings.TrimSpace(os.Getenv(name + "_FILE"))
	if value == "" && path == "" {
		return "", false, nil
	}
	secret, err := secretFromConfiguration(name, maxBytes)
	if err != nil {
		return "", false, err
	}
	return secret, true, nil
}

func secretFromConfiguration(name string, maxBytes int64) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	path := strings.TrimSpace(os.Getenv(name + "_FILE"))
	if (value == "") == (path == "") {
		return "", errors.New("secret must use exactly one source")
	}
	if path == "" {
		if int64(len(value)) > maxBytes {
			return "", errors.New("secret too large")
		}
		return value, nil
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxBytes {
		return "", errors.New("invalid secret file")
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("cannot read secret file")
	}
	value = strings.TrimSpace(string(contents))
	if value == "" || int64(len(value)) > maxBytes {
		return "", errors.New("invalid secret file")
	}
	return value, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	var result []string
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
