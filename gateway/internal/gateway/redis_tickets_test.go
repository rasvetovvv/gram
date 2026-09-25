package gateway

import (
	"context"
	"errors"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisTicketConsumerIsAtomicAndExpires(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	consumer, err := NewRedisTicketConsumer(client)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	consumer.now = func() time.Time { return now }

	first, err := consumer.Consume(context.Background(), "jti-1", now.Add(time.Minute))
	if err != nil || !first {
		t.Fatalf("first consume: accepted=%v err=%v", first, err)
	}
	second, err := consumer.Consume(context.Background(), "jti-1", now.Add(time.Minute))
	if err != nil || second {
		t.Fatalf("second consume: accepted=%v err=%v", second, err)
	}
	server.FastForward(61 * time.Second)
	if server.Exists(ticketKeyPrefix + "jti-1") {
		t.Fatal("ticket marker outlived ticket")
	}
}

func TestRedisTicketConsumerFailsClosedOnBadTTLAndRedisFailure(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	consumer, _ := NewRedisTicketConsumer(client)
	now := time.Unix(1_800_000_000, 0)
	consumer.now = func() time.Time { return now }

	for _, expiry := range []time.Time{now, now.Add(64 * time.Second)} {
		accepted, err := consumer.Consume(context.Background(), "bad-ttl", expiry)
		if accepted || !errors.Is(err, ErrAuthenticationRequired) {
			t.Fatalf("expiry=%v accepted=%v err=%v", expiry, accepted, err)
		}
	}
	server.Close()
	accepted, err := consumer.Consume(context.Background(), "redis-down", now.Add(time.Minute))
	if accepted || err == nil {
		t.Fatalf("Redis failure accepted=%v err=%v", accepted, err)
	}
	_ = client.Close()
}
