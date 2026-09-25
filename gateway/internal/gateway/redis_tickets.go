package gateway

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const ticketKeyPrefix = "gram:wire:ticket:"

type RedisTicketConsumer struct {
	client redis.UniversalClient
	now    func() time.Time
}

func NewRedisTicketConsumer(client redis.UniversalClient) (*RedisTicketConsumer, error) {
	if client == nil {
		return nil, errors.New("gram wire: Redis ticket consumer requires a client")
	}
	return &RedisTicketConsumer{client: client, now: time.Now}, nil
}

func (c *RedisTicketConsumer) Consume(
	ctx context.Context, ticketID string, expiresAt time.Time,
) (bool, error) {
	if ticketID == "" {
		return false, ErrAuthenticationRequired
	}
	ttl := expiresAt.Sub(c.now())
	if ttl <= 0 || ttl > 63*time.Second {
		return false, ErrAuthenticationRequired
	}
	// SET NX is the security boundary: only one gateway replica can consume a jti. The value carries
	// no identity and the key disappears with the ticket, so Redis stores neither a reusable token
	// nor a durable account identifier.
	return c.client.SetNX(ctx, ticketKeyPrefix+ticketID, "1", ttl).Result()
}
