package gateway

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"gram/gateway/internal/wire"
)

func testServer(t *testing.T, now time.Time, used *memoryConsumer) (*Server, ed25519.PublicKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(
		private,
		newHandler(t, now, used),
		[]string{"https://vexory.xyz"},
		func(context.Context) error { return nil },
		log.New(io.Discard, "", 0),
	)
	if err != nil {
		t.Fatal(err)
	}
	return server, public
}

func runWebSocketLoadClient(endpoint, origin, ticket string, identity ed25519.PublicKey) error {
	connection, _, err := websocket.DefaultDialer.Dial(endpoint, http.Header{
		"Origin":                 []string{origin},
		"Sec-WebSocket-Protocol": []string{wireSubprotocol},
	})
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer connection.Close()
	state, hello, err := wire.NewClientHello(time.Now())
	if err != nil {
		return err
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, hello); err != nil {
		return err
	}
	_, response, err := connection.ReadMessage()
	if err != nil {
		return err
	}
	session, err := state.Finish(response, identity)
	if err != nil {
		return err
	}
	for _, envelope := range []wire.Envelope{
		{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": ticket}},
		{Version: 1, Type: "ping", ID: 2, Body: map[string]any{}},
	} {
		encoded, encodeErr := wire.EncodeEnvelope(envelope)
		if encodeErr != nil {
			return encodeErr
		}
		frame, sealErr := session.Seal(encoded)
		if sealErr != nil {
			return sealErr
		}
		if writeErr := connection.WriteMessage(websocket.BinaryMessage, frame); writeErr != nil {
			return writeErr
		}
		_, response, readErr := connection.ReadMessage()
		if readErr != nil {
			return readErr
		}
		plaintext, openErr := session.Open(response)
		if openErr != nil {
			return openErr
		}
		decoded, decodeErr := wire.DecodeEnvelope(plaintext)
		if decodeErr != nil {
			return decodeErr
		}
		if envelope.Type == "auth" && decoded.Type != "ready" {
			return fmt.Errorf("auth response type %q", decoded.Type)
		}
		if envelope.Type == "ping" && decoded.Type != "pong" {
			return fmt.Errorf("ping response type %q", decoded.Type)
		}
	}
	return nil
}

func TestFiftyConcurrentWebSocketSessions(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	used := &memoryConsumer{used: map[string]struct{}{}}
	server, identity := testServer(t, now, used)
	testHTTP := httptest.NewServer(server.HTTPHandler())
	defer testHTTP.Close()
	endpoint := "ws" + strings.TrimPrefix(testHTTP.URL, "http") + "/wire"

	const clients = 50 // below the deliberate per-IP rate limit of 60/minute
	tickets := make([]string, clients)
	for index := range tickets {
		tickets[index] = signedTicket(t, now, fmt.Sprintf("load-%d", index))
	}
	errorsFound := make(chan error, clients)
	var group sync.WaitGroup
	for index := 0; index < clients; index++ {
		group.Add(1)
		go func(ticket string) {
			defer group.Done()
			if err := runWebSocketLoadClient(endpoint, "https://vexory.xyz", ticket, identity); err != nil {
				errorsFound <- err
			}
		}(tickets[index])
	}
	group.Wait()
	close(errorsFound)
	for err := range errorsFound {
		t.Error(err)
	}
}

func TestBrowserOriginsPermitHTTPSAndLoopbackOnly(t *testing.T) {
	accepted := []string{
		"https://vexory.xyz", "https://www.vexory.xyz:443", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000",
	}
	for _, origin := range accepted {
		if !validBrowserOrigin(origin) {
			t.Fatalf("rejected %q", origin)
		}
	}
	rejected := []string{
		"http://vexory.xyz", "ftp://vexory.xyz", "https://user@vexory.xyz", "https://vexory.xyz/path", "https://vexory.xyz?x=1",
	}
	for _, origin := range rejected {
		if validBrowserOrigin(origin) {
			t.Fatalf("accepted %q", origin)
		}
	}
}

func TestTCPEndToEndHandshakeAuthAndPing(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	server, public := testServer(t, now, &memoryConsumer{used: map[string]struct{}{}})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.ServeTCP(ctx, listener) }()

	connection, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	state, hello, err := wire.NewClientHello(now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := connection.Write(hello); err != nil {
		t.Fatal(err)
	}
	response := make([]byte, wire.ServerHelloSize)
	if _, err := io.ReadFull(connection, response); err != nil {
		t.Fatal(err)
	}
	session, err := state.Finish(response, public)
	if err != nil {
		t.Fatal(err)
	}
	auth := encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "tcp")}})
	if err := session.WriteRecord(connection, auth); err != nil {
		t.Fatal(err)
	}
	readyBytes, err := session.ReadRecord(connection)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := wire.DecodeEnvelope(readyBytes)
	if err != nil || ready.Type != "ready" {
		t.Fatalf("ready=%#v err=%v", ready, err)
	}
	ping := encode(t, wire.Envelope{Version: 1, Type: "ping", ID: 2, Body: map[string]any{}})
	if err := session.WriteRecord(connection, ping); err != nil {
		t.Fatal(err)
	}
	pongBytes, err := session.ReadRecord(connection)
	if err != nil {
		t.Fatal(err)
	}
	pong, _ := wire.DecodeEnvelope(pongBytes)
	if pong.Type != "pong" || pong.ID != 2 {
		t.Fatalf("unexpected pong: %#v", pong)
	}
	_ = connection.Close()
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestWebSocketEndToEndAndOriginPolicy(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	server, public := testServer(t, now, &memoryConsumer{used: map[string]struct{}{}})
	httpServer := httptest.NewServer(server.HTTPHandler())
	defer httpServer.Close()
	url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/wire"

	badDialer := websocket.Dialer{Subprotocols: []string{wireSubprotocol}}
	badHeader := http.Header{"Origin": []string{"https://attacker.example"}}
	if connection, response, err := badDialer.Dial(url, badHeader); err == nil {
		_ = connection.Close()
		t.Fatal("foreign Origin accepted")
	} else if response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign Origin status=%v err=%v", response, err)
	}

	dialer := websocket.Dialer{Subprotocols: []string{wireSubprotocol}}
	header := http.Header{"Origin": []string{"https://vexory.xyz"}}
	connection, _, err := dialer.Dial(url, header)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	state, hello, _ := wire.NewClientHello(now)
	if err := connection.WriteMessage(websocket.BinaryMessage, hello); err != nil {
		t.Fatal(err)
	}
	kind, response, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage {
		t.Fatalf("handshake kind=%d err=%v", kind, err)
	}
	session, err := state.Finish(response, public)
	if err != nil {
		t.Fatal(err)
	}
	auth := encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "ws")}})
	frame, _ := session.Seal(auth)
	if err := connection.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		t.Fatal(err)
	}
	kind, encryptedReady, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage {
		t.Fatalf("ready kind=%d err=%v", kind, err)
	}
	readyBytes, err := session.Open(encryptedReady)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := wire.DecodeEnvelope(readyBytes)
	if err != nil || ready.Type != "ready" {
		t.Fatalf("ready=%#v err=%v", ready, err)
	}
}

func TestHealthIsNoStoreAndReadinessAware(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	unavailable := false
	server, err := NewServer(
		private,
		newHandler(t, time.Now(), &memoryConsumer{used: map[string]struct{}{}}),
		[]string{"https://vexory.xyz"},
		func(context.Context) error {
			if unavailable {
				return io.ErrClosedPipe
			}
			return nil
		},
		log.New(io.Discard, "", 0),
	)
	if err != nil {
		t.Fatal(err)
	}
	testServer := httptest.NewServer(server.HTTPHandler())
	defer testServer.Close()
	response, err := http.Get(testServer.URL + "/health") // #nosec G107 -- local test server
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d cache=%q", response.StatusCode, response.Header.Get("Cache-Control"))
	}
	_ = response.Body.Close()
	unavailable = true
	response, err = http.Get(testServer.URL + "/health") // #nosec G107 -- local test server
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status=%d", response.StatusCode)
	}
	_ = response.Body.Close()
}

func TestMetricsRequireATokenAndCountRealTraffic(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	server, identity := testServer(t, now, &memoryConsumer{used: map[string]struct{}{}})
	testHTTP := httptest.NewServer(server.HTTPHandler())
	defer testHTTP.Close()

	// Fail closed before a token is installed.
	response, err := http.Get(testHTTP.URL + "/metrics") // #nosec G107 -- local test server
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthenticated metrics status=%d, want 403", response.StatusCode)
	}
	_ = response.Body.Close()

	if err := server.SetMetricsToken("short"); err == nil {
		t.Fatal("a short metrics token must be rejected")
	}
	token := strings.Repeat("m", 48)
	if err := server.SetMetricsToken(token); err != nil {
		t.Fatal(err)
	}

	// The token is accepted only through the standard Bearer scheme.
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, testHTTP.URL+"/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", token)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("raw-token metrics status=%d, want 403", response.StatusCode)
	}
	_ = response.Body.Close()

	// A wrong token stays forbidden even once metrics are enabled.
	request, err = http.NewRequestWithContext(context.Background(), http.MethodGet, testHTTP.URL+"/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("x", 48))
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong-token metrics status=%d, want 403", response.StatusCode)
	}
	_ = response.Body.Close()

	// Drive one real authenticated session so the counters cannot be a static stub.
	endpoint := "ws" + strings.TrimPrefix(testHTTP.URL, "http") + "/wire"
	if err := runWebSocketLoadClient(endpoint, "https://vexory.xyz", signedTicket(t, now, "metrics"), identity); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(server.connections) != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(server.connections) != 0 {
		t.Fatal("connection gauge did not return to zero")
	}

	request, err = http.NewRequestWithContext(context.Background(), http.MethodGet, testHTTP.URL+"/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8192))
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("status=%d err=%v", response.StatusCode, err)
	}
	exposition := string(body)
	for _, expected := range []string{
		"gram_wire_sessions_validated_total 1",
		"gram_wire_auth_ready_total 1",
		"gram_wire_connections_active 0",
	} {
		if !strings.Contains(exposition, expected) {
			t.Fatalf("metrics missing %q in:\n%s", expected, exposition)
		}
	}
	if strings.Contains(exposition, token) {
		t.Fatal("metrics must never echo the token")
	}
}
