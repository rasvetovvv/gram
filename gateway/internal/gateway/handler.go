package gateway

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"gram/gateway/internal/tickets"
	"gram/gateway/internal/wire"
)

var (
	ErrAuthenticationRequired = errors.New("gram wire: authentication required")
	ErrTicketReused           = errors.New("gram wire: protocol ticket already consumed")
	ErrProtocol               = errors.New("gram wire: protocol violation")
	ErrChannelBinding         = errors.New("gram wire: protocol ticket is not bound to this channel")
)

type TicketValidator interface {
	Validate(string) (*tickets.Claims, error)
}

type TicketConsumer interface {
	Consume(ctx context.Context, ticketID string, expiresAt time.Time) (bool, error)
}

// Channel is an encrypted record transport. TCP and WebSocket adapters implement the same contract.
// ChannelBinding returns the handshake-unique value both peers agree on, so the auth layer can
// require that a ticket was minted for this exact encrypted session.
type Channel interface {
	Read(ctx context.Context) ([]byte, error)
	Write(ctx context.Context, plaintext []byte) error
	ChannelBinding() []byte
	Close() error
}

type Handler struct {
	Tickets         TicketValidator
	Used            TicketConsumer
	Events          EventStore
	Sessions        SessionValidator
	RevalidateEvery time.Duration
	Now             func() time.Time
	Observe         func(stage string)
	// RequireChannelBinding rejects any ticket that omits the channel-binding confirmation.
	// A ticket that carries one is always verified regardless of this flag, so a browser that
	// binds its ticket is protected even before every legacy minting path is updated.
	RequireChannelBinding bool
}

type inboundEnvelope struct {
	envelope wire.Envelope
	err      error
}

func (h *Handler) Serve(ctx context.Context, channel Channel) error {
	if h.Tickets == nil || h.Used == nil || h.Sessions == nil {
		return errors.New("gram wire: gateway authentication is not configured")
	}
	revalidateEvery := h.RevalidateEvery
	if revalidateEvery <= 0 {
		revalidateEvery = time.Minute
	}
	now := h.Now
	if now == nil {
		now = time.Now
	}
	defer channel.Close()

	claims, requestID, err := h.authenticate(ctx, channel)
	if err != nil {
		return err
	}
	if err := h.Sessions.Validate(ctx, claims.Subject, claims.SessionID); err != nil {
		return ErrAuthenticationRequired
	}
	h.observe("session_validated")
	if err := writeEnvelope(ctx, channel, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "ready",
		ID:      requestID,
		Body: map[string]any{
			"user_id":     claims.Subject,
			"session_id":  claims.SessionID,
			"server_time": now().Unix(),
		},
	}); err != nil {
		return err
	}
	h.observe("auth_ready_sent")

	incoming := make(chan inboundEnvelope, 1)
	go readEnvelopes(ctx, channel, incoming)
	revalidation := time.NewTicker(revalidateEvery)
	defer revalidation.Stop()
	var subscription EventSubscription
	var liveEvents <-chan Event
	var liveErrors <-chan error
	var lastSent uint64
	var lastAck uint64
	defer func() {
		if subscription != nil {
			_ = subscription.Close()
		}
	}()

	for {
		select {
		case input := <-incoming:
			if input.err != nil {
				return input.err
			}
			switch input.envelope.Type {
			case "ping":
				if err := writeEnvelope(ctx, channel, wire.Envelope{
					Version: wire.EnvelopeVersion,
					Type:    "pong",
					ID:      input.envelope.ID,
					Body:    map[string]any{"server_time": now().Unix()},
				}); err != nil {
					return err
				}
			case "resume":
				h.observe("resume_received")
				if subscription != nil {
					return ErrProtocol
				}
				cursor, ok := unsignedBodyValue(input.envelope.Body, "last_event_id")
				if !ok {
					return ErrProtocol
				}
				if h.Events == nil {
					if err := writeError(ctx, channel, input.envelope.ID, "NOT_READY"); err != nil {
						return err
					}
					continue
				}
				// Subscribe first. Any event committed while Replay runs is queued in Pub/Sub; duplicate
				// IDs are removed below, so there is no replay/live handoff gap.
				subscription, err = h.Events.Subscribe(ctx, claims.Subject)
				if err != nil {
					return fmt.Errorf("%w: %v", ErrEventSubscribe, err)
				}
				h.observe("event_subscribed")
				replayed, replayErr := h.Events.Replay(ctx, claims.Subject, cursor, 1000)
				if errors.Is(replayErr, ErrCursorExpired) {
					_ = subscription.Close()
					subscription = nil
					if err := writeEnvelope(ctx, channel, wire.Envelope{
						Version: wire.EnvelopeVersion,
						Type:    "resync_required",
						ID:      input.envelope.ID,
						Body:    map[string]any{"code": "RESYNC_REQUIRED", "reason": "CURSOR_EXPIRED"},
					}); err != nil {
						return err
					}
					continue
				}
				if replayErr != nil {
					return fmt.Errorf("%w: %v", ErrEventReplay, replayErr)
				}
				h.observe("event_replayed")
				lastSent = cursor
				for _, event := range replayed {
					if err := h.sendEvent(ctx, channel, event); err != nil {
						return err
					}
					lastSent = event.ID
				}
				if err := writeEnvelope(ctx, channel, wire.Envelope{
					Version: wire.EnvelopeVersion,
					Type:    "ready",
					ID:      input.envelope.ID,
					Body:    map[string]any{"resume_cursor": lastSent},
				}); err != nil {
					return err
				}
				h.observe("resume_ready_sent")
				liveEvents = subscription.Events()
				liveErrors = subscription.Errors()
			case "ack":
				cursor, ok := unsignedBodyValue(input.envelope.Body, "event_id")
				if !ok || cursor < lastAck || cursor > lastSent {
					return ErrProtocol
				}
				lastAck = cursor
			case "rpc":
				if err := writeError(ctx, channel, input.envelope.ID, "NOT_READY"); err != nil {
					return err
				}
			default:
				return ErrProtocol
			}
		case event, ok := <-liveEvents:
			if !ok {
				return errors.New("gram wire: live event stream closed")
			}
			if event.ID <= lastSent {
				continue
			}
			if event.ID != lastSent+1 {
				// Pub/Sub is only a wakeup/fan-out path. Recover any dropped live notification from the
				// durable stream rather than sending a sequence gap to the client.
				missing, err := h.Events.Replay(ctx, claims.Subject, lastSent, 1000)
				if err != nil {
					return fmt.Errorf("%w: %v", ErrEventReplay, err)
				}
				for _, recovered := range missing {
					if recovered.ID <= lastSent {
						continue
					}
					if err := h.sendEvent(ctx, channel, recovered); err != nil {
						return err
					}
					lastSent = recovered.ID
				}
				continue
			}
			if err := h.sendEvent(ctx, channel, event); err != nil {
				return err
			}
			lastSent = event.ID
		case err := <-liveErrors:
			if err == nil {
				return errors.New("gram wire: live event error stream closed")
			}
			return err
		case <-revalidation.C:
			checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err := h.Sessions.Validate(checkCtx, claims.Subject, claims.SessionID)
			cancel()
			if err != nil {
				return ErrAuthenticationRequired
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func readEnvelopes(ctx context.Context, channel Channel, output chan<- inboundEnvelope) {
	for {
		plaintext, err := channel.Read(ctx)
		if err != nil {
			select {
			case output <- inboundEnvelope{err: err}:
			case <-ctx.Done():
			}
			return
		}
		envelope, err := wire.DecodeEnvelope(plaintext)
		select {
		case output <- inboundEnvelope{envelope: envelope, err: err}:
		case <-ctx.Done():
			return
		}
		if err != nil {
			return
		}
	}
}

func (h *Handler) authenticate(ctx context.Context, channel Channel) (*tickets.Claims, uint64, error) {
	plaintext, err := channel.Read(ctx)
	if err != nil {
		return nil, 0, err
	}
	envelope, err := wire.DecodeEnvelope(plaintext)
	if err != nil || envelope.Type != "auth" || envelope.ID == 0 {
		return nil, 0, ErrAuthenticationRequired
	}
	ticket, ok := envelope.Body["ticket"].(string)
	if !ok || ticket == "" {
		return nil, 0, ErrAuthenticationRequired
	}
	claims, err := h.Tickets.Validate(ticket)
	if err != nil {
		return nil, 0, ErrAuthenticationRequired
	}
	if err := h.verifyChannelBinding(claims, channel.ChannelBinding()); err != nil {
		return nil, 0, err
	}
	consumed, err := h.Used.Consume(ctx, claims.ID, time.Unix(claims.ExpiresAt, 0))
	if err != nil {
		return nil, 0, fmt.Errorf("consume protocol ticket: %w", err)
	}
	if !consumed {
		return nil, 0, ErrTicketReused
	}
	return claims, envelope.ID, nil
}

// verifyChannelBinding ties a ticket to the encrypted session it was presented on. The API mints
// the ticket with cnf = base64url(SHA-256(channel_binding)) supplied by the browser; the gateway
// recomputes the binding from its own handshake and requires an exact match. A ticket stolen from
// one connection therefore cannot be replayed on another, because a different handshake yields a
// different binding. A ticket with no cnf is accepted only while RequireChannelBinding is off, so
// the field can be rolled out before it is enforced.
func (h *Handler) verifyChannelBinding(claims *tickets.Claims, binding []byte) error {
	if claims.Confirmation == "" {
		if h.RequireChannelBinding {
			return ErrChannelBinding
		}
		return nil
	}
	expected := channelBindingConfirmation(binding)
	if subtle.ConstantTimeCompare([]byte(claims.Confirmation), []byte(expected)) != 1 {
		return ErrChannelBinding
	}
	return nil
}

// channelBindingConfirmation is the exact string the API embeds in the ticket's cnf claim:
// the URL-safe, unpadded base64 of the SHA-256 of the 32-byte channel binding.
func channelBindingConfirmation(binding []byte) string {
	digest := sha256.Sum256(binding)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func unsignedBodyValue(body map[string]any, key string) (uint64, bool) {
	value, ok := body[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case uint64:
		return typed, true
	case uint32:
		return uint64(typed), true
	case uint16:
		return uint64(typed), true
	case uint8:
		return uint64(typed), true
	case int64:
		return uint64(typed), typed >= 0
	case int:
		return uint64(typed), typed >= 0
	default:
		return 0, false
	}
}

func (h *Handler) sendEvent(ctx context.Context, channel Channel, event Event) error {
	if event.ID == 0 || event.Type == "" {
		return ErrProtocol
	}
	if err := writeEnvelope(ctx, channel, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "event",
		Body: map[string]any{
			"event_id":   event.ID,
			"event_type": event.Type,
			"payload":    event.Body,
		},
	}); err != nil {
		return err
	}
	h.observe("event_sent")
	return nil
}

func writeError(ctx context.Context, channel Channel, requestID uint64, code string) error {
	return writeEnvelope(ctx, channel, wire.Envelope{
		Version: wire.EnvelopeVersion,
		Type:    "error",
		ID:      requestID,
		Body:    map[string]any{"code": code},
	})
}

func (h *Handler) observe(stage string) {
	if h.Observe != nil {
		h.Observe(stage)
	}
}

func writeEnvelope(ctx context.Context, channel Channel, envelope wire.Envelope) error {
	encoded, err := wire.EncodeEnvelope(envelope)
	if err != nil {
		return err
	}
	return channel.Write(ctx, encoded)
}
