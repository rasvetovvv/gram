package gateway

import (
	"context"
	"errors"
)

var (
	ErrCursorExpired  = errors.New("gram wire: resume cursor expired")
	ErrEventSubscribe = errors.New("gram wire: event subscription failed")
	ErrEventReplay    = errors.New("gram wire: event replay failed")
)

// Event is a durable, user-scoped invalidation or domain event. ID is monotonic per user.
// Delivery is at-least-once; clients deduplicate by ID and acknowledge only after applying it.
type Event struct {
	ID   uint64
	Type string
	Body map[string]any
}

type EventSubscription interface {
	Events() <-chan Event
	Errors() <-chan error
	Close() error
}

type EventStore interface {
	// Replay returns retained events newer than after. ErrCursorExpired means the client must use
	// authoritative HTTP state before opening a fresh cursor.
	Replay(ctx context.Context, userID string, after uint64, limit int64) ([]Event, error)
	// Subscribe must be opened before Replay so events published during replay queue behind it.
	Subscribe(ctx context.Context, userID string) (EventSubscription, error)
}
