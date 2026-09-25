package gateway

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"gram/gateway/internal/wire"
)

type Server struct {
	identity       ed25519.PrivateKey
	handler        *Handler
	allowedOrigins map[string]struct{}
	ready          func(context.Context) error
	logger         *log.Logger
	upgrader       websocket.Upgrader
	connections    chan struct{}
	handshakes     chan struct{}
	ipLimiter      *ipHandshakeLimiter
	metrics        *gatewayMetrics
	metricsToken   string
}

// SetMetricsToken gates /metrics behind a shared secret. Metrics stay unreachable until a token of at
// least 32 bytes is installed, so an accidentally routed port cannot leak operational counters.
func (s *Server) SetMetricsToken(token string) error {
	if len(token) < 32 {
		return errors.New("gram wire: metrics token must be at least 32 bytes")
	}
	s.metricsToken = token
	return nil
}

func NewServer(
	identity ed25519.PrivateKey,
	handler *Handler,
	origins []string,
	ready func(context.Context) error,
	logger *log.Logger,
) (*Server, error) {
	if len(identity) != ed25519.PrivateKeySize || handler == nil || ready == nil || logger == nil {
		return nil, errors.New("gram wire: server is not configured")
	}
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin == "" || !validBrowserOrigin(origin) {
			return nil, errors.New("gram wire: browser origin must be explicit HTTPS or loopback HTTP")
		}
		allowed[origin] = struct{}{}
	}
	if len(allowed) == 0 {
		return nil, errors.New("gram wire: no browser origins configured")
	}
	server := &Server{
		identity: identity, handler: handler, allowedOrigins: allowed, ready: ready, logger: logger,
		connections: make(chan struct{}, maxOpenConnections),
		handshakes:  make(chan struct{}, maxActiveHandshakes),
		ipLimiter:   newIPHandshakeLimiter(time.Now()),
		metrics:     &gatewayMetrics{},
	}
	observer := handler.Observe
	handler.Observe = func(stage string) {
		server.metrics.observe(stage)
		if observer != nil {
			observer(stage)
		}
	}
	server.upgrader = websocket.Upgrader{
		HandshakeTimeout: handshakeTimeout,
		Subprotocols:     []string{wireSubprotocol},
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		CheckOrigin: func(request *http.Request) bool {
			return originAllowed(request, server.allowedOrigins)
		},
	}
	return server, nil
}

func (s *Server) PublicKeyBase64() string {
	public := s.identity.Public().(ed25519.PublicKey)
	return base64.RawStdEncoding.EncodeToString(public)
}

func (s *Server) PublicKeyFingerprint() string {
	public := s.identity.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(public)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (s *Server) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/metrics", s.serveMetrics)
	mux.HandleFunc("/wire", s.serveWebSocket)
	return securityHeaders(mux)
}

func (s *Server) serveMetrics(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	// Fail closed: without a configured token there is no way to read counters at all.
	authorization := request.Header.Get("Authorization")
	if !strings.HasPrefix(authorization, "Bearer ") || s.metricsToken == "" {
		http.Error(response, "forbidden", http.StatusForbidden)
		return
	}
	presentedHash := sha256.Sum256([]byte(strings.TrimPrefix(authorization, "Bearer ")))
	expectedHash := sha256.Sum256([]byte(s.metricsToken))
	if subtle.ConstantTimeCompare(presentedHash[:], expectedHash[:]) != 1 {
		http.Error(response, "forbidden", http.StatusForbidden)
		return
	}
	response.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_ = s.metrics.write(response, len(s.connections), len(s.handshakes))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(response, request)
	})
}

func (s *Server) health(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), time.Second)
	defer cancel()
	if err := s.ready(ctx); err != nil {
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(map[string]any{"status": "ok", "protocol": wire.Version})
}

func (s *Server) serveWebSocket(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet || !originAllowed(request, s.allowedOrigins) || !hasSubprotocol(request, wireSubprotocol) {
		http.Error(response, "upgrade rejected", http.StatusForbidden)
		return
	}
	if !s.ipLimiter.Allow(request.RemoteAddr, request.Header.Get("X-Forwarded-For"), time.Now()) {
		http.Error(response, "rate limited", http.StatusTooManyRequests)
		return
	}
	if !tryAcquire(s.connections) {
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
		return
	}
	defer release(s.connections)
	if !tryAcquire(s.handshakes) {
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
		return
	}
	handshakeHeld := true
	defer func() {
		if handshakeHeld {
			release(s.handshakes)
		}
	}()
	connection, err := s.upgrader.Upgrade(response, request, nil)
	if err != nil {
		return
	}
	if err := connection.SetReadDeadline(time.Now().Add(handshakeTimeout)); err != nil {
		_ = connection.Close()
		return
	}
	kind, hello, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || len(hello) != wire.ClientHelloSize {
		_ = connection.Close()
		return
	}
	serverHello, session, err := wire.AcceptClientHello(hello, s.identity, time.Now(), 30*time.Second)
	if err != nil {
		_ = connection.Close()
		return
	}
	if err := connection.SetWriteDeadline(time.Now().Add(handshakeTimeout)); err != nil {
		_ = connection.Close()
		return
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, serverHello); err != nil {
		_ = connection.Close()
		return
	}
	release(s.handshakes)
	handshakeHeld = false
	_ = connection.SetReadDeadline(time.Time{})
	_ = connection.SetWriteDeadline(time.Time{})
	if err := s.handler.Serve(request.Context(), newWebSocketChannel(connection, session)); err != nil {
		s.logConnectionEnd("websocket", err)
	}
}

func (s *Server) ServeTCP(ctx context.Context, listener net.Listener) error {
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		connection, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			if temporary, ok := err.(interface{ Temporary() bool }); ok && temporary.Temporary() {
				continue
			}
			return err
		}
		if !s.ipLimiter.Allow(connection.RemoteAddr().String(), "", time.Now()) ||
			!tryAcquire(s.connections) {
			_ = connection.Close()
			continue
		}
		go func() {
			defer release(s.connections)
			s.handleTCP(ctx, connection)
		}()
	}
}

func (s *Server) handleTCP(ctx context.Context, connection net.Conn) {
	if !tryAcquire(s.handshakes) {
		_ = connection.Close()
		return
	}
	handshakeHeld := true
	defer func() {
		if handshakeHeld {
			release(s.handshakes)
		}
	}()
	_ = connection.SetDeadline(time.Now().Add(handshakeTimeout))
	hello := make([]byte, wire.ClientHelloSize)
	if _, err := io.ReadFull(connection, hello); err != nil {
		_ = connection.Close()
		return
	}
	serverHello, session, err := wire.AcceptClientHello(hello, s.identity, time.Now(), 30*time.Second)
	if err != nil {
		_ = connection.Close()
		return
	}
	if err := writeAll(connection, serverHello); err != nil {
		_ = connection.Close()
		return
	}
	release(s.handshakes)
	handshakeHeld = false
	_ = connection.SetDeadline(time.Time{})
	if err := s.handler.Serve(ctx, newTCPChannel(connection, session)); err != nil {
		s.logConnectionEnd("tcp", err)
	}
}

func validBrowserOrigin(origin string) bool {
	parsed, err := url.ParseRequestURI(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "localhost" {
		return true
	}
	address := net.ParseIP(hostname)
	return address != nil && address.IsLoopback()
}

func writeAll(writer io.Writer, payload []byte) error {
	for len(payload) > 0 {
		written, err := writer.Write(payload)
		if err != nil {
			return err
		}
		if written <= 0 {
			return io.ErrShortWrite
		}
		payload = payload[written:]
	}
	return nil
}

func (s *Server) logConnectionEnd(transport string, err error) {
	// Never log tickets, payloads, user ids, session ids, addresses or exception strings.
	class := "io"
	switch {
	case errors.Is(err, ErrAuthenticationRequired), errors.Is(err, ErrTicketReused):
		class = "auth"
	case errors.Is(err, ErrEventSubscribe):
		class = "event_subscribe"
	case errors.Is(err, ErrEventReplay):
		class = "event_replay"
	case errors.Is(err, ErrProtocol), errors.Is(err, wire.ErrInvalidSequence):
		class = "protocol"
	}
	s.metrics.connectionClosed(class)
	s.logger.Printf("connection_closed transport=%s class=%s", transport, class)
}
