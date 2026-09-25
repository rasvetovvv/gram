package gateway

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/vmihailenco/msgpack/v5"
)

const (
	eventKeyPrefix     = "gram:wire:events:"
	eventSeqKeyPrefix  = "gram:wire:event-seq:"
	eventLiveKeyPrefix = "gram:wire:live:"
	maxEventBytes      = 256 << 10
)

var publishEventScript = redis.NewScript(`
local existing = redis.call('GET', KEYS[4])
if existing then
  return tonumber(existing)
end
local id = redis.call('INCR', KEYS[1])
local stream_id = tostring(id) .. '-0'
local payload = tostring(id) .. '|' .. ARGV[1]
redis.call('XADD', KEYS[2], stream_id, 'payload', payload)
redis.call('XTRIM', KEYS[2], 'MAXLEN', '=', ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('SET', KEYS[4], tostring(id), 'EX', ARGV[3])
redis.call('PUBLISH', KEYS[3], payload)
return id
`)

type eventPayload struct {
	ID   uint64         `msgpack:"id"`
	Type string         `msgpack:"type"`
	Body map[string]any `msgpack:"body"`
}

type RedisEventStore struct {
	client    redis.UniversalClient
	maxLen    int64
	retention time.Duration
	queueLen  int
}

func NewRedisEventStore(
	client redis.UniversalClient, maxLen int64, retention time.Duration,
) (*RedisEventStore, error) {
	if client == nil || maxLen < 100 || maxLen > 100_000 ||
		retention < time.Hour || retention > 30*24*time.Hour {
		return nil, errors.New("gram wire: invalid Redis event store configuration")
	}
	return &RedisEventStore{
		client: client, maxLen: maxLen, retention: retention, queueLen: 256,
	}, nil
}

// Publish appends and fans out atomically. The outbox idempotency key maps retries to the original
// event cursor, so a worker crash after Redis publication but before PostgreSQL acknowledgement does
// not allocate or deliver a second application event.
func (s *RedisEventStore) Publish(
	ctx context.Context, userID, eventType, idempotencyKey string, body map[string]any,
) (uint64, error) {
	if err := validateEventIdentity(userID, eventType); err != nil {
		return 0, err
	}
	if idempotencyKey == "" || len(idempotencyKey) > 128 ||
		strings.ContainsAny(idempotencyKey, "\r\n{} ") {
		return 0, errors.New("gram wire: invalid event idempotency key")
	}
	// The stream ID is needed inside the payload, so reserve it in the same Lua script by encoding
	// a temporary zero ID and having Lua patching would be unsafe. Instead the durable stream ID is
	// authoritative; readers overwrite payload.ID from the stream ID. Live readers do the same by
	// receiving the script return only through a small outer envelope generated below.
	bodyBytes, err := msgpack.Marshal(eventPayload{Type: eventType, Body: body})
	if err != nil || len(bodyBytes) > maxEventBytes {
		return 0, errors.New("gram wire: invalid event payload")
	}
	result, err := publishEventScript.Run(
		ctx,
		s.client,
		[]string{
			eventSeqKeyPrefix + userID,
			eventKeyPrefix + userID,
			eventLiveKeyPrefix + userID,
			"gram:wire:outbox:" + idempotencyKey,
		},
		bodyBytes,
		s.maxLen,
		int64(s.retention/time.Second),
	).Uint64()
	if err != nil {
		return 0, fmt.Errorf("publish durable event: %w", err)
	}
	return result, nil
}

func (s *RedisEventStore) Replay(
	ctx context.Context, userID string, after uint64, limit int64,
) ([]Event, error) {
	if userID == "" || limit < 1 || limit > 1000 || after > math.MaxInt64 {
		return nil, errors.New("gram wire: invalid replay request")
	}
	stream := eventKeyPrefix + userID
	oldest, err := s.client.XRangeN(ctx, stream, "-", "+", 1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	if len(oldest) == 0 {
		if after != 0 {
			return nil, ErrCursorExpired
		}
		return []Event{}, nil
	}
	oldestID, err := streamSequence(oldest[0].ID)
	if err != nil {
		return nil, err
	}
	if after != 0 && oldestID > after+1 {
		return nil, ErrCursorExpired
	}
	start := "(" + strconv.FormatUint(after, 10) + "-0"
	messages, err := s.client.XRangeN(ctx, stream, start, "+", limit).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	events := make([]Event, 0, len(messages))
	for _, message := range messages {
		event, err := decodeStreamEvent(message)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}

func (s *RedisEventStore) Subscribe(ctx context.Context, userID string) (EventSubscription, error) {
	if userID == "" {
		return nil, errors.New("gram wire: empty subscription user")
	}
	pubsub := s.client.Subscribe(ctx, eventLiveKeyPrefix+userID)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, err
	}
	sub := &redisEventSubscription{
		pubsub: pubsub,
		events: make(chan Event, s.queueLen),
		errors: make(chan error, 1),
		done:   make(chan struct{}),
	}
	go sub.run()
	return sub, nil
}

type redisEventSubscription struct {
	pubsub *redis.PubSub
	events chan Event
	errors chan error
	done   chan struct{}
	once   sync.Once
}

func (s *redisEventSubscription) Events() <-chan Event { return s.events }
func (s *redisEventSubscription) Errors() <-chan error { return s.errors }
func (s *redisEventSubscription) Close() error {
	var err error
	s.once.Do(func() {
		close(s.done)
		err = s.pubsub.Close()
	})
	return err
}

func (s *redisEventSubscription) run() {
	defer close(s.events)
	channel := s.pubsub.Channel(redis.WithChannelSize(cap(s.events)))
	for {
		select {
		case <-s.done:
			return
		case message, ok := <-channel:
			if !ok {
				return
			}
			id, encoded, err := splitStoredPayload([]byte(message.Payload))
			if err != nil {
				s.fail(err)
				return
			}
			payload, err := decodeEventPayload(encoded)
			if err != nil {
				s.fail(err)
				return
			}
			select {
			case s.events <- Event{ID: id, Type: payload.Type, Body: payload.Body}:
			case <-s.done:
				return
			default:
				s.fail(errors.New("gram wire: slow event consumer"))
				return
			}
		}
	}
}

func (s *redisEventSubscription) fail(err error) {
	select {
	case s.errors <- err:
	default:
	}
}

func decodeEventPayload(encoded []byte) (eventPayload, error) {
	if len(encoded) == 0 || len(encoded) > maxEventBytes {
		return eventPayload{}, errors.New("gram wire: invalid event payload size")
	}
	decoder := msgpack.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields(true)
	var payload eventPayload
	if err := decoder.Decode(&payload); err != nil {
		return eventPayload{}, errors.New("gram wire: malformed event payload")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return eventPayload{}, errors.New("gram wire: trailing event payload")
	}
	if err := validateEventIdentity("event", payload.Type); err != nil || payload.Body == nil {
		return eventPayload{}, errors.New("gram wire: invalid event payload")
	}
	return payload, nil
}

func decodeStreamEvent(message redis.XMessage) (Event, error) {
	raw, ok := message.Values["payload"]
	if !ok {
		return Event{}, errors.New("gram wire: stream event has no payload")
	}
	var encoded []byte
	switch value := raw.(type) {
	case string:
		encoded = []byte(value)
	case []byte:
		encoded = value
	default:
		return Event{}, errors.New("gram wire: invalid stream payload type")
	}
	id, encoded, err := splitStoredPayload(encoded)
	if err != nil {
		return Event{}, err
	}
	streamID, err := streamSequence(message.ID)
	if err != nil || streamID != id {
		return Event{}, errors.New("gram wire: event cursor mismatch")
	}
	payload, err := decodeEventPayload(encoded)
	if err != nil {
		return Event{}, err
	}
	return Event{ID: id, Type: payload.Type, Body: payload.Body}, nil
}

func splitStoredPayload(stored []byte) (uint64, []byte, error) {
	if len(stored) > maxEventBytes+32 {
		return 0, nil, errors.New("gram wire: oversized stream payload")
	}
	separator := strings.IndexByte(string(stored), '|')
	if separator < 1 || separator > 20 || separator == len(stored)-1 {
		return 0, nil, errors.New("gram wire: malformed stored event")
	}
	id, err := strconv.ParseUint(string(stored[:separator]), 10, 64)
	if err != nil || id == 0 {
		return 0, nil, errors.New("gram wire: invalid stored event cursor")
	}
	return id, stored[separator+1:], nil
}

func streamSequence(id string) (uint64, error) {
	parts := strings.Split(id, "-")
	if len(parts) != 2 || parts[1] != "0" {
		return 0, errors.New("gram wire: invalid stream cursor")
	}
	value, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil || value == 0 {
		return 0, errors.New("gram wire: invalid stream cursor")
	}
	return value, nil
}

func validateEventIdentity(userID, eventType string) error {
	if userID == "" || len(userID) > 128 || eventType == "" || len(eventType) > 96 {
		return errors.New("gram wire: invalid event identity")
	}
	if strings.ContainsAny(userID, "\r\n{} ") || strings.ContainsAny(eventType, "\r\n{} ") {
		return errors.New("gram wire: invalid event identity")
	}
	return nil
}
