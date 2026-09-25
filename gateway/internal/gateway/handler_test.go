package gateway

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"gram/gateway/internal/tickets"
	"gram/gateway/internal/wire"
)

const testSecret = "test-wire-ticket-secret-at-least-32-bytes"

type fakeChannel struct {
	reads   [][]byte
	writes  [][]byte
	binding []byte
	closed  bool
}

func (c *fakeChannel) Read(context.Context) ([]byte, error) {
	if len(c.reads) == 0 {
		return nil, io.EOF
	}
	value := c.reads[0]
	c.reads = c.reads[1:]
	return value, nil
}

func (c *fakeChannel) Write(_ context.Context, value []byte) error {
	c.writes = append(c.writes, append([]byte(nil), value...))
	return nil
}

func (c *fakeChannel) ChannelBinding() []byte { return c.binding }

func (c *fakeChannel) Close() error { c.closed = true; return nil }

type memoryConsumer struct {
	mu   sync.Mutex
	used map[string]struct{}
}

func (c *memoryConsumer) Consume(_ context.Context, id string, _ time.Time) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.used[id]; exists {
		return false, nil
	}
	c.used[id] = struct{}{}
	return true, nil
}

func encode(t *testing.T, envelope wire.Envelope) []byte {
	t.Helper()
	encoded, err := wire.EncodeEnvelope(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func signedTicket(t *testing.T, now time.Time, id string) string {
	t.Helper()
	return signedTicketWithConfirmation(t, now, id, "")
}

func signedTicketWithConfirmation(t *testing.T, now time.Time, id, confirmation string) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	claims := map[string]any{
		"sub": "user-1", "sid": "session-1", "jti": id, "type": "wire_ticket",
		"aud": "gram-wire", "iss": "gram-api", "iat": now.Unix(), "nbf": now.Unix(),
		"exp": now.Add(time.Minute).Unix(),
	}
	if confirmation != "" {
		claims["cnf"] = confirmation
	}
	claimsJSON, _ := json.Marshal(claims)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claimsJSON)
	mac := hmac.New(sha256.New, []byte(testSecret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// bindingConfirmation mirrors the gateway's own derivation so a test ticket can carry a cnf that
// matches a channel binding.
func bindingConfirmation(binding []byte) string {
	digest := sha256.Sum256(binding)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

type sessionValidatorFunc func(context.Context, string, string) error

func (validator sessionValidatorFunc) Validate(
	ctx context.Context, userID, sessionID string,
) error {
	return validator(ctx, userID, sessionID)
}

func newHandler(t *testing.T, now time.Time, used *memoryConsumer) *Handler {
	t.Helper()
	validator, err := tickets.NewValidator(testSecret, "gram-api")
	if err != nil {
		t.Fatal(err)
	}
	return &Handler{
		Tickets: validator,
		Used:    used,
		Sessions: sessionValidatorFunc(func(context.Context, string, string) error {
			return nil
		}),
		Now: func() time.Time { return now },
	}
}

func TestRequiresAuthThenAnswersPing(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "one")}}),
		encode(t, wire.Envelope{Version: 1, Type: "ping", ID: 2, Body: map[string]any{}}),
	}}
	err := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}}).Serve(context.Background(), channel)
	if !errors.Is(err, io.EOF) {
		t.Fatalf("got %v, want EOF after test input", err)
	}
	if !channel.closed || len(channel.writes) != 2 {
		t.Fatalf("closed=%v writes=%d", channel.closed, len(channel.writes))
	}
	ready, _ := wire.DecodeEnvelope(channel.writes[0])
	pong, _ := wire.DecodeEnvelope(channel.writes[1])
	if ready.Type != "ready" || ready.Body["user_id"] != "user-1" {
		t.Fatalf("unexpected ready: %#v", ready)
	}
	if pong.Type != "pong" || pong.ID != 2 {
		t.Fatalf("unexpected pong: %#v", pong)
	}
}

func TestTicketIsSingleUse(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	used := &memoryConsumer{used: map[string]struct{}{}}
	auth := func() []byte {
		return encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "same")}})
	}
	first := &fakeChannel{reads: [][]byte{auth()}}
	if err := newHandler(t, now, used).Serve(context.Background(), first); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	second := &fakeChannel{reads: [][]byte{auth()}}
	if err := newHandler(t, now, used).Serve(context.Background(), second); !errors.Is(err, ErrTicketReused) {
		t.Fatalf("got %v, want ErrTicketReused", err)
	}
}

type fakeSubscription struct {
	events chan Event
	errors chan error
}

func (s *fakeSubscription) Events() <-chan Event { return s.events }
func (s *fakeSubscription) Errors() <-chan error { return s.errors }
func (s *fakeSubscription) Close() error         { return nil }

type fakeEventStore struct {
	replay    []Event
	replayErr error
	sub       *fakeSubscription
}

func (s *fakeEventStore) Replay(context.Context, string, uint64, int64) ([]Event, error) {
	return s.replay, s.replayErr
}
func (s *fakeEventStore) Subscribe(context.Context, string) (EventSubscription, error) {
	return s.sub, nil
}

func TestResumeReplaysDurableEvents(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "resume")}}),
		encode(t, wire.Envelope{Version: 1, Type: "resume", ID: 2, Body: map[string]any{"last_event_id": uint64(3)}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	observed := map[string]int{}
	handler.Observe = func(stage string) { observed[stage]++ }
	handler.Events = &fakeEventStore{
		replay: []Event{{ID: 4, Type: "chat.changed", Body: map[string]any{"chat_id": "c1"}}},
		sub:    &fakeSubscription{events: make(chan Event), errors: make(chan error)},
	}
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	if len(channel.writes) != 3 {
		t.Fatalf("writes=%d", len(channel.writes))
	}
	event, _ := wire.DecodeEnvelope(channel.writes[1])
	resumed, _ := wire.DecodeEnvelope(channel.writes[2])
	if event.Type != "event" || event.Body["event_id"] != uint64(4) {
		t.Fatalf("event=%#v", event)
	}
	if resumed.Type != "ready" || resumed.Body["resume_cursor"] != uint64(4) {
		t.Fatalf("resumed=%#v", resumed)
	}
	for _, stage := range []string{"session_validated", "auth_ready_sent", "event_replayed", "event_sent", "resume_ready_sent"} {
		if observed[stage] != 1 {
			t.Fatalf("stage %q observed %d times", stage, observed[stage])
		}
	}
}

func TestExpiredCursorRequiresHTTPResync(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "expired")}}),
		encode(t, wire.Envelope{Version: 1, Type: "resume", ID: 2, Body: map[string]any{"last_event_id": uint64(1)}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	handler.Events = &fakeEventStore{
		replayErr: ErrCursorExpired,
		sub:       &fakeSubscription{events: make(chan Event), errors: make(chan error)},
	}
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	response, _ := wire.DecodeEnvelope(channel.writes[1])
	if response.Type != "resync_required" || response.Body["reason"] != "CURSOR_EXPIRED" {
		t.Fatalf("response=%#v", response)
	}
}

func TestRevokedBackingSessionIsRejectedBeforeReady(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{"ticket": signedTicket(t, now, "revoked")}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	handler.Sessions = sessionValidatorFunc(func(context.Context, string, string) error {
		return ErrAuthenticationRequired
	})
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, ErrAuthenticationRequired) {
		t.Fatalf("got %v", err)
	}
	if len(channel.writes) != 0 {
		t.Fatal("ready was sent for revoked session")
	}
}

func TestFirstFrameMustAuthenticate(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{reads: [][]byte{encode(t, wire.Envelope{Version: 1, Type: "ping", ID: 1, Body: map[string]any{}})}}
	err := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}}).Serve(context.Background(), channel)
	if !errors.Is(err, ErrAuthenticationRequired) {
		t.Fatalf("got %v, want ErrAuthenticationRequired", err)
	}
}

func TestChannelBoundTicketMatchesTheHandshake(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	binding := bytes.Repeat([]byte{0x5a}, 32)
	channel := &fakeChannel{binding: binding, reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{
			"ticket": signedTicketWithConfirmation(t, now, "bound", bindingConfirmation(binding)),
		}}),
		encode(t, wire.Envelope{Version: 1, Type: "ping", ID: 2, Body: map[string]any{}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	handler.RequireChannelBinding = true
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, io.EOF) {
		t.Fatalf("got %v, want EOF after test input", err)
	}
	if len(channel.writes) != 2 {
		t.Fatalf("writes=%d", len(channel.writes))
	}
	ready, _ := wire.DecodeEnvelope(channel.writes[0])
	if ready.Type != "ready" {
		t.Fatalf("unexpected ready: %#v", ready)
	}
}

func TestChannelBoundTicketRejectedOnADifferentChannel(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	minted := bytes.Repeat([]byte{0x11}, 32)
	// A ticket minted for `minted` is replayed on a connection whose handshake produced a
	// different binding. The gateway must refuse it even though the ticket signature is valid.
	channel := &fakeChannel{binding: bytes.Repeat([]byte{0x22}, 32), reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{
			"ticket": signedTicketWithConfirmation(t, now, "stolen", bindingConfirmation(minted)),
		}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, ErrChannelBinding) {
		t.Fatalf("got %v, want ErrChannelBinding", err)
	}
	if len(channel.writes) != 0 {
		t.Fatal("ready was sent for a ticket bound to another channel")
	}
}

func TestUnboundTicketRejectedWhenBindingRequired(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{binding: bytes.Repeat([]byte{0x33}, 32), reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{
			"ticket": signedTicket(t, now, "legacy"),
		}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	handler.RequireChannelBinding = true
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, ErrChannelBinding) {
		t.Fatalf("got %v, want ErrChannelBinding", err)
	}
}

func TestUnboundTicketAcceptedWhenBindingOptional(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	channel := &fakeChannel{binding: bytes.Repeat([]byte{0x44}, 32), reads: [][]byte{
		encode(t, wire.Envelope{Version: 1, Type: "auth", ID: 1, Body: map[string]any{
			"ticket": signedTicket(t, now, "legacy-ok"),
		}}),
	}}
	handler := newHandler(t, now, &memoryConsumer{used: map[string]struct{}{}})
	if err := handler.Serve(context.Background(), channel); !errors.Is(err, io.EOF) {
		t.Fatalf("got %v, want EOF", err)
	}
	if len(channel.writes) != 1 {
		t.Fatalf("writes=%d, want 1 ready", len(channel.writes))
	}
}
