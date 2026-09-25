package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"gram/gateway/internal/wire"
)

const (
	wireSubprotocol  = "gram-wire-v1"
	probeTimeout     = 15 * time.Second
	liveProbeTimeout = 30 * time.Second
	maxTicketBytes   = 4096
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "wire_wss_probe=failed stage=%s\n", err)
		os.Exit(1)
	}
	fmt.Println("wire_wss_probe=ok transport=wss handshake=verified auth=verified resume=verified ping=verified")
}

func run() error {
	identity, err := readIdentityPublicKey(os.Getenv("WIRE_PROBE_IDENTITY_PUBLIC_KEY_FILE"))
	if err != nil {
		return err
	}
	ticket, err := readTicket(os.Stdin)
	if err != nil {
		return err
	}
	endpoint, err := validateEndpoint(os.Getenv("WIRE_PROBE_URL"))
	if err != nil {
		return err
	}
	origin := strings.TrimSpace(os.Getenv("WIRE_PROBE_ORIGIN"))
	if origin == "" {
		return errors.New("origin is required")
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: probeTimeout,
		Subprotocols:     []string{wireSubprotocol},
	}
	connection, response, err := dialer.Dial(endpoint, http.Header{"Origin": []string{origin}})
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
	if err != nil {
		return errors.New("websocket dial failed")
	}
	defer connection.Close()
	if connection.Subprotocol() != wireSubprotocol {
		return errors.New("websocket subprotocol mismatch")
	}
	connection.SetReadLimit(int64(wire.MaxCiphertext + 8))
	if err := connection.SetReadDeadline(time.Now().Add(probeTimeout)); err != nil {
		return errors.New("read deadline failed")
	}
	if err := connection.SetWriteDeadline(time.Now().Add(probeTimeout)); err != nil {
		return errors.New("write deadline failed")
	}

	state, clientHello, err := wire.NewClientHello(time.Now())
	if err != nil {
		return errors.New("client hello failed")
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, clientHello); err != nil {
		return errors.New("client hello write failed")
	}
	kind, serverHello, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || len(serverHello) != wire.ServerHelloSize {
		return errors.New("server hello read failed")
	}
	session, err := state.Finish(serverHello, identity)
	if err != nil {
		return errors.New("server identity verification failed")
	}

	if err := writeEnvelope(connection, session, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "auth",
		ID:      1,
		Body:    map[string]any{"ticket": ticket},
	}); err != nil {
		return err
	}
	if err := expectEnvelope(connection, session, "ready", 1); err != nil {
		return err
	}
	if err := writeEnvelope(connection, session, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "resume",
		ID:      2,
		Body:    map[string]any{"last_event_id": uint64(0)},
	}); err != nil {
		return err
	}
	nextRequestID := uint64(3)
	for {
		envelope, err := readEnvelope(connection, session)
		if err != nil {
			return err
		}
		if envelope.Type == "ready" && envelope.ID == 2 {
			break
		}
		if envelope.Type != "event" {
			return errors.New("unexpected resume response")
		}
		eventID, ok := envelope.Body["event_id"].(uint64)
		if !ok || eventID == 0 {
			return errors.New("invalid replay event")
		}
		if err := writeEnvelope(connection, session, wire.Envelope{
			Version: wire.EnvelopeVersion,
			Type:    "ack",
			ID:      nextRequestID,
			Body:    map[string]any{"event_id": eventID},
		}); err != nil {
			return err
		}
		nextRequestID++
	}
	if os.Getenv("WIRE_PROBE_EXPECT_LIVE_EVENT") == "true" {
		deadline := time.Now().Add(liveProbeTimeout)
		if err := connection.SetReadDeadline(deadline); err != nil {
			return errors.New("live read deadline failed")
		}
		if err := connection.SetWriteDeadline(deadline); err != nil {
			return errors.New("live write deadline failed")
		}
		fmt.Println("wire_wss_probe=awaiting_live_event")
		envelope, err := readEnvelope(connection, session)
		if err != nil {
			return err
		}
		if envelope.Type != "event" {
			return errors.New("expected live event")
		}
		eventID, ok := envelope.Body["event_id"].(uint64)
		if !ok || eventID == 0 {
			return errors.New("invalid live event")
		}
		if err := writeEnvelope(connection, session, wire.Envelope{
			Version: wire.EnvelopeVersion,
			Type:    "ack",
			ID:      nextRequestID,
			Body:    map[string]any{"event_id": eventID},
		}); err != nil {
			return err
		}
		nextRequestID++
	}
	if err := writeEnvelope(connection, session, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "ping",
		ID:      nextRequestID,
		Body:    map[string]any{},
	}); err != nil {
		return err
	}
	return expectEnvelope(connection, session, "pong", nextRequestID)
}

func validateEndpoint(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "wss" || parsed.Host == "" || parsed.User != nil ||
		parsed.Path != "/wire" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("WSS endpoint is invalid")
	}
	return parsed.String(), nil
}

func readIdentityPublicKey(path string) (ed25519.PublicKey, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("identity pin file is required")
	}
	encoded, err := os.ReadFile(path)
	if err != nil || len(encoded) > 256 {
		return nil, errors.New("identity pin file is invalid")
	}
	value := strings.TrimSpace(string(encoded))
	decoders := []*base64.Encoding{
		base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding, base64.URLEncoding,
	}
	var decoded []byte
	for _, decoder := range decoders {
		decoded, err = decoder.DecodeString(value)
		if err == nil {
			break
		}
	}
	if err != nil || len(decoded) != ed25519.PublicKeySize {
		return nil, errors.New("identity pin file is invalid")
	}
	return ed25519.PublicKey(decoded), nil
}

func readTicket(reader io.Reader) (string, error) {
	payload, err := io.ReadAll(io.LimitReader(reader, maxTicketBytes+1))
	if err != nil || len(payload) > maxTicketBytes {
		return "", errors.New("ticket input is invalid")
	}
	ticket := strings.TrimSpace(string(payload))
	if ticket == "" || strings.ContainsAny(ticket, "\r\n\x00") {
		return "", errors.New("ticket input is invalid")
	}
	return ticket, nil
}

func writeEnvelope(connection *websocket.Conn, session *wire.Session, envelope wire.Envelope) error {
	encoded, err := wire.EncodeEnvelope(envelope)
	if err != nil {
		return errors.New("envelope encode failed")
	}
	frame, err := session.Seal(encoded)
	if err != nil {
		return errors.New("encrypted record seal failed")
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return errors.New("encrypted record write failed")
	}
	return nil
}

func readEnvelope(connection *websocket.Conn, session *wire.Session) (wire.Envelope, error) {
	kind, frame, err := connection.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage {
		return wire.Envelope{}, errors.New("encrypted record read failed")
	}
	plaintext, err := session.Open(frame)
	if err != nil {
		return wire.Envelope{}, errors.New("encrypted record open failed")
	}
	envelope, err := wire.DecodeEnvelope(plaintext)
	if err != nil {
		return wire.Envelope{}, errors.New("envelope decode failed")
	}
	return envelope, nil
}

func expectEnvelope(connection *websocket.Conn, session *wire.Session, expectedType string, expectedID uint64) error {
	envelope, err := readEnvelope(connection, session)
	if err != nil {
		return err
	}
	if envelope.Type != expectedType || envelope.ID != expectedID {
		return errors.New("unexpected protocol response")
	}
	return nil
}
