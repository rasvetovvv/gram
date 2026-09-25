package gateway

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
)

func newRedisEventStore(t *testing.T) (*RedisEventStore, *redis.Client, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	store, err := NewRedisEventStore(client, 100, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return store, client, server
}

func TestRealRedisSubscribeAndReplayEmptyStream(t *testing.T) {
	address := os.Getenv("GRAM_REDIS_TEST_URL")
	if address == "" {
		t.Skip("GRAM_REDIS_TEST_URL is not configured")
	}
	client := redis.NewClient(&redis.Options{Addr: address})
	defer client.Close()
	store, err := NewRedisEventStore(client, 100, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	subscription, err := store.Subscribe(ctx, "real-empty")
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if _, err := store.Replay(ctx, "real-empty", 0, 100); err != nil {
		t.Fatal(err)
	}
}

func TestSubscribeAndReplayEmptyStream(t *testing.T) {
	store, _, _ := newRedisEventStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	subscription, err := store.Subscribe(ctx, "user-empty")
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	events, err := store.Replay(ctx, "user-empty", 0, 100)
	if err != nil || len(events) != 0 {
		t.Fatalf("events=%v err=%v", events, err)
	}
}

func TestRedisEventPublishReplayAndLiveCursor(t *testing.T) {
	store, _, _ := newRedisEventStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	subscription, err := store.Subscribe(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()

	first, err := store.Publish(ctx, "user-1", "chat.message_created", "outbox-1", map[string]any{"message_id": "m1"})
	if err != nil || first != 1 {
		t.Fatalf("first=%d err=%v", first, err)
	}
	second, err := store.Publish(ctx, "user-1", "chat.message_created", "outbox-2", map[string]any{"message_id": "m2"})
	if err != nil || second != 2 {
		t.Fatalf("second=%d err=%v", second, err)
	}

	for expected := uint64(1); expected <= 2; expected++ {
		select {
		case event := <-subscription.Events():
			if event.ID != expected || event.Type != "chat.message_created" {
				t.Fatalf("event=%#v expected=%d", event, expected)
			}
		case err := <-subscription.Errors():
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal("timed out waiting for live event")
		}
	}

	replayed, err := store.Replay(ctx, "user-1", 1, 100)
	if err != nil || len(replayed) != 1 || replayed[0].ID != 2 {
		t.Fatalf("replayed=%#v err=%v", replayed, err)
	}
	if replayed[0].Body["message_id"] != "m2" {
		t.Fatalf("body=%#v", replayed[0].Body)
	}
}

func TestPublishIsIdempotentByOutboxKey(t *testing.T) {
	store, client, _ := newRedisEventStore(t)
	ctx := context.Background()
	first, err := store.Publish(ctx, "user-dedupe", "chat.changed", "same-outbox", nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Publish(ctx, "user-dedupe", "chat.changed", "same-outbox", nil)
	if err != nil || first != second {
		t.Fatalf("first=%d second=%d err=%v", first, second, err)
	}
	if count := client.XLen(ctx, eventKeyPrefix+"user-dedupe").Val(); count != 1 {
		t.Fatalf("duplicate stream entries=%d", count)
	}
}

func TestReplayReportsExpiredCursor(t *testing.T) {
	store, client, _ := newRedisEventStore(t)
	ctx := context.Background()
	for index := 0; index < 3; index++ {
		if _, err := store.Publish(ctx, "user-2", "chat.changed", fmt.Sprintf("outbox-%d", index), map[string]any{"n": index}); err != nil {
			t.Fatal(err)
		}
	}
	if err := client.XDel(ctx, eventKeyPrefix+"user-2", "1-0", "2-0").Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Replay(ctx, "user-2", 1, 100); !errors.Is(err, ErrCursorExpired) {
		t.Fatalf("got %v, want ErrCursorExpired", err)
	}
	fresh, err := store.Replay(ctx, "user-2", 0, 100)
	if err != nil || len(fresh) != 1 || fresh[0].ID != 3 {
		t.Fatalf("fresh=%#v err=%v", fresh, err)
	}
}

func TestEventStoreFailsClosedOnBadInputAndRedisFailure(t *testing.T) {
	store, client, server := newRedisEventStore(t)
	ctx := context.Background()
	if _, err := store.Publish(ctx, "bad user", "chat.changed", "bad", nil); err == nil {
		t.Fatal("invalid user accepted")
	}
	server.Close()
	if _, err := store.Publish(ctx, "user-3", "chat.changed", "redis-down", nil); err == nil {
		t.Fatal("Redis failure accepted")
	}
	_ = client.Close()
}

func TestIdleStreamExpiresWithoutResettingSequence(t *testing.T) {
	store, client, server := newRedisEventStore(t)
	ctx := context.Background()
	if id, err := store.Publish(ctx, "user-ttl", "chat.changed", "ttl-first", nil); err != nil || id != 1 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	if ttl := server.TTL(eventKeyPrefix + "user-ttl"); ttl <= 0 || ttl > 7*24*time.Hour {
		t.Fatalf("ttl=%v", ttl)
	}
	server.FastForward(7*24*time.Hour + time.Second)
	if client.Exists(ctx, eventKeyPrefix+"user-ttl").Val() != 0 {
		t.Fatal("idle stream did not expire")
	}
	if _, err := store.Replay(ctx, "user-ttl", 1, 100); !errors.Is(err, ErrCursorExpired) {
		t.Fatalf("got %v, want cursor expiry", err)
	}
	if id, err := store.Publish(ctx, "user-ttl", "chat.changed", "ttl-second", nil); err != nil || id != 2 {
		t.Fatalf("sequence reset: id=%d err=%v", id, err)
	}
}

func TestEventPayloadDecoderRejectsUnknownAndTrailingData(t *testing.T) {
	unknown, err := msgpack.Marshal(map[string]any{
		"type": "chat.changed", "body": map[string]any{"chat_id": "one"}, "unknown": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeEventPayload(unknown); err == nil {
		t.Fatal("unknown field accepted")
	}
	valid, err := msgpack.Marshal(eventPayload{Type: "chat.changed", Body: map[string]any{"chat_id": "one"}})
	if err != nil {
		t.Fatal(err)
	}
	trailing, err := msgpack.Marshal("extra")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeEventPayload(append(valid, trailing...)); err == nil {
		t.Fatal("trailing object accepted")
	}
}

func TestStoredPayloadBindsCursor(t *testing.T) {
	store, client, _ := newRedisEventStore(t)
	ctx := context.Background()
	if _, err := store.Publish(ctx, "user-4", "chat.changed", "bound", nil); err != nil {
		t.Fatal(err)
	}
	message, err := client.XRangeN(ctx, eventKeyPrefix+"user-4", "-", "+", 1).Result()
	if err != nil || len(message) != 1 {
		t.Fatal(err)
	}
	message[0].ID = "2-0"
	if _, err := decodeStreamEvent(message[0]); err == nil {
		t.Fatal("cursor/payload mismatch accepted")
	}
}
