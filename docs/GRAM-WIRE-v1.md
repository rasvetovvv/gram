# GRAM Wire Protocol v1

Status: public opt-in canary with full chat and social outbox parity. Gateway, Redis Streams/PubSub and the PostgreSQL outbox are deployed; `/wire` is routed through Caddy; the production web bundle permits Wire only when `localStorage["gram-wire-canary"]` is exactly `"1"`. Legacy JSON WebSockets remain authoritative (`NEXT_PUBLIC_GRAM_WIRE_PRIMARY=false`) until load soak and rollback rehearsal complete.

## Goals

GRAM Wire v1 is a client-to-server transport for authenticated RPC and realtime events. It provides:

- WebSocket over TLS for browsers and framed TCP for native clients;
- an authenticated ephemeral handshake;
- AEAD encryption for every application frame;
- strict replay and reordering rejection;
- resumable ordered event streams;
- cross-replica delivery through Redis Streams/PubSub;
- bounded frames, timeouts, rate limits and periodic session revalidation;
- protocol negotiation and a fallback to the existing HTTP/JSON realtime channel.

It is **not end-to-end encryption**. The API stores and renders chat messages. E2EE, if added later, is a separate content layer with different keys and recovery semantics.

## Trust boundaries

- TLS protects browser-to-edge traffic and hides the WebSocket upgrade from passive network observers.
- GRAM Wire additionally authenticates the gateway with a pinned Ed25519 public key and encrypts frames end to end from client code to the gateway process.
- The gateway, API, PostgreSQL and Redis are trusted server-side components.
- Redis carries only bounded event envelopes; durable chat state remains in PostgreSQL.
- A connection is not trusted merely because its handshake succeeded. It must authenticate an application session and that session is revalidated throughout the socket lifetime.

## Cryptographic handshake

All integer fields are big-endian.

### ClientHello

| Field | Bytes |
|---|---:|
| magic `GRM1` | 4 |
| version | 2 |
| unix timestamp | 8 |
| client ephemeral X25519 public key | 32 |
| client random | 16 |

The gateway rejects unsupported versions and timestamps outside a bounded skew.

### ServerHello

| Field | Bytes |
|---|---:|
| magic `GRM1` | 4 |
| negotiated version | 2 |
| server ephemeral X25519 public key | 32 |
| server random | 16 |
| Ed25519 signature | 64 |

The signature covers `"GRAM-WIRE-v1" || ClientHello || ServerHello-without-signature`. The client verifies it against the public key shipped with the client; a key supplied only by the connection is not trusted.

Both sides compute X25519 and HKDF-SHA256 with:

- salt: `client_random || server_random`;
- info: `GRAM-WIRE-v1/session`;
- output: `c2s_key(32) || s2c_key(32) || c2s_nonce_prefix(4) || s2c_nonce_prefix(4)`.

Private ephemeral keys are discarded after derivation.

## Encrypted frames

TCP framing:

| Field | Bytes |
|---|---:|
| ciphertext length | 4 |
| sequence number | 8 |
| AES-256-GCM ciphertext + tag | variable |

WebSocket uses one binary message containing `sequence || ciphertext`; the WebSocket message boundary supplies the length.

Nonce: `direction_nonce_prefix(4) || sequence(8)`.

AAD: `magic || version || direction || sequence`.

Sequence numbers begin at 1 independently in each direction. A receiver accepts exactly its next expected number. Duplicate, skipped, wrapped or reordered frames close the connection. A key/nonce pair is never reused.

Plaintext is MessagePack:

```text
{
  v: 1,
  type: "auth" | "ready" | "rpc" | "event" | "ack" | "resume" |
        "ping" | "pong" | "error" | "resync_required",
  id: uint64,
  body: map
}
```

Maximum encrypted frame: 1 MiB. Maximum uncompressed body and collection sizes are validated before business handling. Compression is absent in v1 to avoid compression-oracle and decompression-bomb classes.

## Authentication

Handshake authentication proves the gateway, not the user. The first encrypted application frame must be `auth` with a short-lived, audience-bound, single-use protocol ticket minted by the existing authenticated HTTP API.

The ticket binds:

- user id;
- refresh-session id;
- audience `gram-wire`;
- issue and expiry time (maximum 60 seconds);
- random ticket id consumed atomically in Redis;
- optional channel binding (`cnf`) tying the ticket to one encrypted session (see below).

Raw refresh cookies and passwords never enter protocol payloads. The browser requests a ticket with `POST /api/auth/wire-ticket` using its existing httpOnly cookie; the ticket alone is sent in the first encrypted frame. The gateway verifies it with a dedicated ticket key (never the access-JWT key), consumes its `jti` atomically in Redis, and calls `POST /api/internal/wire/session-check` with a separate internal secret. Connections are closed on logout, password change, ban, session revocation or introspection failure; sockets are revalidated at least once per minute.

### Channel binding

Both peers derive, from the same X25519 shared secret but a distinct HKDF label (`GRAM-WIRE-v1/channel-binding`), a 32-byte value unique to the completed handshake and unpredictable to any third party. It is not a record-layer key.

The browser sends `SHA-256(channel_binding)` as unpadded URL-safe base64 in the `X-Gram-Wire-Channel-Binding` header when requesting a ticket. The API embeds it verbatim as the ticket's `cnf` claim. The gateway recomputes the binding from its own side of the handshake and requires `cnf` to match with a constant-time comparison. A ticket captured on one connection therefore cannot be replayed on another, because a different handshake produces a different binding.

Rollout is fail-open then fail-closed: a ticket with no `cnf` is accepted while the gateway's `WIRE_REQUIRE_CHANNEL_BINDING` is `false` (default), so a browser that has not been rebuilt still authenticates; a ticket that does carry `cnf` is always verified. Once every client mints bound tickets, setting `WIRE_REQUIRE_CHANNEL_BINDING=true` rejects any unbound ticket outright. A malformed header is a `400`, never a silently unbound ticket.

## Resume and delivery

Every durable or invalidation event has a per-user monotonically increasing `event_id`. The client persists only the last fully applied id and sends `resume(last_event_id)` after authentication.

Redis Streams retain a bounded replay window. The gateway:

1. subscribes to the live Pub/Sub channel first;
2. replays Stream events after `last_event_id` in order;
3. deduplicates queued live events by `event_id`, closing the replay/live handoff gap;
4. returns `ready {resume_cursor}` only after replay has been sent;
5. requires `ack {event_id}` after the client has applied and persisted each event;
6. trims the backlog by exact count and idle age, never by an untrusted client value.

If the cursor predates retention, the gateway sends `resync_required {code: "RESYNC_REQUIRED", reason: "CURSOR_EXPIRED"}`. The client refetches authoritative HTTP state, clears its local cursor and resumes from zero. Typing indicators are ephemeral Pub/Sub events and are never replayed.

Delivery is at-least-once. Client application logic must be idempotent by event/message id. Exactly-once delivery is not claimed.

## Redis fan-out

- `gram:wire:event-seq:<user_id>`: persistent monotonic per-user sequence.
- `gram:wire:events:<user_id>`: bounded durable Redis Stream; idle streams expire after seven days.
- `gram:wire:live:<user_id>`: Pub/Sub wakeup/live fan-out carrying the same stored payload.
- `gram:wire:outbox:<outbox_id>`: idempotency mapping from a PostgreSQL outbox row to its first Redis cursor.
- `gram:wire:ticket:<jti>`: single-use auth ticket marker with ticket-bound TTL.

API chat mutations add one minimal per-user `realtime_outbox` row in the same PostgreSQL transaction as the domain mutation. A `FOR UPDATE SKIP LOCKED` worker invokes an atomic Redis Lua script (`dedupe → INCR → XADD → XTRIM → EXPIRE → PUBLISH`) and marks the row delivered. A crash after Redis publication is safe because retrying the same outbox id returns its original cursor. Direct `commit; publish` is prohibited because a crash between those operations loses realtime delivery.

Current durable chat parity covers `chat.message_created`, `chat.message_edited`, `chat.message_deleted`, `chat.message_reacted`, `chat.message_pinned`, and `chat.read`. Each mutation queues one row per chat member before the domain transaction commits; the browser maps every `chat.*` event to the existing thin `chat_activity` invalidation contract while legacy per-chat sockets remain authoritative. `typing` deliberately remains ephemeral legacy/PubSub state and is never written to the durable outbox.

Durable social parity covers `post_created`, `post_updated`, `post_deleted`, `post_reacted`, `comment_created`, `comment_updated`, `comment_deleted`, and `comment_reacted`. Each is queued inside the same transaction as its domain mutation and fanned out one row per active account, filtered by the same visibility rules the HTTP feed enforces: an account blocked in either direction receives nothing, and a private author reaches only itself and its followers. A scheduled post queues nothing until it is actually published, because the event is what tells other readers to refetch. Social events keep the existing thin invalidation contract — the frame says only that something changed and carries `post_id`, optional `comment_id` and `actor_id`, never post content — so an event can never leak a body the recipient is not allowed to fetch.

Delivered rows are receipts, not state: a background pruner deletes rows whose `published_at` predates the Redis replay window, one bounded batch at a time. Unpublished rows and rows parked with `invalid_payload` are never pruned, so neither an undelivered event nor the evidence of a bug is erased.

## Rollout

1. Add Redis and gateway with no public route.
2. Exercise protocol unit tests and an isolated integration stack.
3. Add outbox publishing while current JSON sockets remain authoritative.
4. Expose `/wire` behind Caddy and enable only for internal synthetic users.
5. Add browser client with automatic fallback to `/ws/social`, `/ws/chats/*` and HTTP polling.
6. Canary by percentage; compare delivery gaps, reconnect rate and p95 latency.
7. Keep old sockets until a full rollback/forward-deploy rehearsal and soak pass.

## Runtime configuration

Secrets have independent purposes and must never be reused:

- `WIRE_TICKET_SECRET[_FILE]`: API ticket signing and Gateway verification;
- `WIRE_INTERNAL_SECRET[_FILE]`: Gateway-to-API session introspection;
- `WIRE_IDENTITY_PRIVATE_KEY_B64[_FILE]`: persistent Ed25519 Gateway identity (32-byte seed or 64-byte private key, base64);
- `WIRE_METRICS_TOKEN[_FILE]`: optional independent bearer token (minimum 32 bytes) for the Prometheus-compatible `/metrics` endpoint; when unset the endpoint always returns `403`;
- `WIRE_REQUIRE_CHANNEL_BINDING`: when `true`, the gateway rejects any ticket without a `cnf` channel binding; default `false` accepts unbound tickets during rollout while still verifying bound ones;
- `NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64`: public browser pin derived from that identity;
- `NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64`: optional comma-separated additional pins the browser also trusts, so an identity key can be rotated without locking out clients still running the previous bundle.

### Identity rotation

The gateway identity is a long-term Ed25519 key pinned in the client bundle. To rotate it without breaking connected or stale clients:

1. Generate the new key pair and ship a build that keeps trusting the old pin: set `NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64` to the *old* pin and add the *new* pin to `NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64` (or vice-versa — order is trust priority, not correctness). Deploy the web bundle first, so every browser trusts both pins.
2. Switch the gateway's `WIRE_IDENTITY_PRIVATE_KEY_B64` to the new key and restart it. Browsers verify the new signature against the new pin they already trust.
3. After the old bundle has aged out of caches, ship a build that lists only the new pin and drop the old one.

Because the browser accepts a handshake signed by *any* trusted pin, there is never a window where a client on one build cannot reach a gateway on the other.

Production uses mounted secret files. Supplying both a value and its `_FILE` variant is a startup error. `WIRE_ALLOWED_ORIGINS` is an exact allowlist; plaintext origins are accepted only for loopback development. The Gateway HTTP port is reachable only through Caddy/private Docker networks, and the internal session endpoint is authenticated and excluded from public OpenAPI.

Browser rollout is compile-time gated by:

- `NEXT_PUBLIC_GRAM_WIRE_ENABLED=false` (safe default; `true` permits encrypted shadow traffic);
- `NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY=true` (safe default; even when Wire is built in, only a browser with `localStorage["gram-wire-canary"] = "1"` may connect);
- `NEXT_PUBLIC_GRAM_WIRE_PRIMARY=false` (legacy social remains authoritative until event parity is proven);
- `NEXT_PUBLIC_GRAM_WIRE_URL=wss://vexory.xyz/wire`;
- `NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64=<public pin>`.

Canary-only mode is deliberately fail-closed: missing/inaccessible local storage or any value other than the exact string `1` keeps the browser on legacy realtime. Removing canary-only mode requires an explicit build with `NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY=false`; it is never inferred from the public route being available.

The Gateway Compose services remain under profile `wire`. Starting normal production Compose without that profile does not start Redis or Gateway.

## Verification evidence

Before canary, the following gates must remain green:

- `go test ./... -race -count=1` and `go vet ./...`;
- `govulncheck ./...` using the same patched Go toolchain as the container build;
- full API pytest suite plus Ruff and type checks for changed modules;
- frontend Vitest, TypeScript, ESLint, production build and `npm audit`;
- isolated real-Redis outbox idempotency test;
- browser E2E proving handshake/auth/resume, live event application, persisted cursor, reconnect replay and forced Gateway-down legacy fallback.

Repeatable production checks live in `api/tools/`:

- `social_outbox_probe.py` — stages one social event inside a rolled-back transaction and reports the recipient fan-out without writing anything;
- `wire_canary_account.py` — creates, credentials and removes an isolated synthetic canary account (`wirecanary*`), and enqueues a single outbox row on demand;
- `wire_social_canary.sh` — mints a real ticket, connects over public WSS with identity pinning, and proves an enqueued social event arrives as a live encrypted frame;
- `wire_soak.sh` — samples outbox lag, stale rows, error classes, session count, container health, `/health`, `/`, the WSS-only `/wire` refusal and adjacent Caddy domains, then fails on any regression.

The canary account and its rows must be dropped after every run; nothing named `wirecanary*` belongs in a steady-state database.

Reference benchmark on the current VPS (AMD EPYC, three 2-second samples): handshake roughly 0.43–0.55 ms; 1 KiB seal+open roughly 5.1–5.7 µs (181–201 MB/s); MessagePack envelope round trip roughly 6–10.5 µs. These are engineering baselines, not an SLA; canary metrics and a multi-minute connection soak remain authoritative.

## Rollback

1. Rebuild/deploy the web image with `NEXT_PUBLIC_GRAM_WIRE_ENABLED=false`. New page loads immediately use legacy sockets; connected Wire clients also fall back when Gateway closes.
2. Remove/disable the Caddy `/wire` route, then stop only the `gateway` service.
3. Set `WIRE_OUTBOX_ENABLED=false` and recreate the API only after clients are back on legacy. Existing PostgreSQL messages remain authoritative. This also stops the outbox pruner, so nothing is deleted while the incident is under investigation.
4. Keep Redis/outbox data during investigation; do not drop `realtime_outbox` or reset cursor sequence keys during rollback.
5. Verify login/session continuity, `/ws/social`, `/ws/chats/{chat_id}`, HTTP polling, public health endpoints and adjacent Caddy domains.

No production claim of E2EE, censorship resistance, exactly-once delivery or metadata hiding is permitted by this protocol.
