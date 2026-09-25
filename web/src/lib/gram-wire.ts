import { decode, encode } from "@msgpack/msgpack";
import { API_URL } from "./api";

const MAGIC = new Uint8Array([0x47, 0x52, 0x4d, 0x31]);
const VERSION = 1;
const CLIENT_HELLO_SIZE = 62;
const SERVER_HELLO_SIZE = 118;
const MAX_CIPHERTEXT = 1 << 20;
const HANDSHAKE_TIMEOUT = 10_000;
const MAX_CURSOR = 9_223_372_036_854_775_807n;
const SIGNATURE_LABEL = new TextEncoder().encode("GRAM-WIRE-v1");
const HKDF_INFO = new TextEncoder().encode("GRAM-WIRE-v1/session");
const CHANNEL_BINDING_INFO = new TextEncoder().encode("GRAM-WIRE-v1/channel-binding");

export const GRAM_WIRE_ENABLED =
  process.env.NEXT_PUBLIC_GRAM_WIRE_ENABLED === "true" &&
  Boolean(process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64);
export const GRAM_WIRE_PRIMARY =
  GRAM_WIRE_ENABLED && process.env.NEXT_PUBLIC_GRAM_WIRE_PRIMARY === "true";
export const GRAM_WIRE_CANARY_ONLY =
  process.env.NEXT_PUBLIC_GRAM_WIRE_CANARY_ONLY !== "false";
const GRAM_WIRE_CANARY_KEY = "gram-wire-canary";

/**
 * Every Ed25519 gateway identity this build trusts, newest first. Rotation ships a new key in
 * NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64 while the previous key stays in
 * NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64 (comma-separated) so a browser holding the old
 * bundle and a gateway serving the new key can still complete a handshake during the overlap.
 */
export function gramWireIdentityPins(): string[] {
  const pins: string[] = [];
  const primary = process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64 ?? "";
  if (primary) pins.push(primary.trim());
  const extra = process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64 ?? "";
  for (const candidate of extra.split(",")) {
    const trimmed = candidate.trim();
    if (trimmed && !pins.includes(trimmed)) pins.push(trimmed);
  }
  return pins;
}

export function gramWireRolloutAllowsBrowser(
  enabled: boolean,
  canaryOnly: boolean,
  optIn: string | null
) {
  return enabled && (!canaryOnly || optIn === "1");
}

export function gramWireBrowserEnabled() {
  if (typeof window === "undefined") return false;
  let optIn: string | null = null;
  try {
    optIn = localStorage.getItem(GRAM_WIRE_CANARY_KEY);
  } catch {
    return false;
  }
  return gramWireRolloutAllowsBrowser(GRAM_WIRE_ENABLED, GRAM_WIRE_CANARY_ONLY, optIn);
}

export function gramWireSocialEventType(eventType: string) {
  return eventType.startsWith("chat.") ? "chat_activity" : eventType;
}

export type GramWireEvent = {
  id: bigint;
  type: string;
  body: Record<string, unknown>;
};

export type GramWireFailure = "transport" | "handshake" | "authentication" | "protocol" | "unsupported" | "internal";

export function gramWireFailureClass(reason: unknown): GramWireFailure {
  const message = reason instanceof Error ? reason.message.toLowerCase() : "";
  if (message.includes("unsupported")) return "unsupported";
  if (message.includes("ticket") || message.includes("authentication")) return "authentication";
  if (
    message.includes("hello") ||
    message.includes("identity") ||
    message.includes("x25519") ||
    message.includes("hkdf")
  ) {
    return "handshake";
  }
  if (
    message.includes("frame") ||
    message.includes("envelope") ||
    message.includes("sequence") ||
    message.includes("protocol") ||
    message.includes("event") ||
    message.includes("unexpected")
  ) {
    return "protocol";
  }
  if (
    message.includes("network") ||
    message.includes("closed") ||
    message.includes("timeout") ||
    message.includes("connected")
  ) {
    return "transport";
  }
  return "internal";
}

export type GramWireCallbacks = {
  onEvent: (event: GramWireEvent) => void | Promise<void>;
  onResync: () => void | Promise<void>;
  onDisconnect?: (reason: GramWireFailure) => void;
};

type Envelope = {
  v: number;
  type: string;
  id: bigint | number;
  body: Record<string, unknown>;
};

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

function asBigInt(value: unknown, field: string) {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^\d{1,20}$/.test(value)) parsed = BigInt(value);
  else throw new Error(`invalid ${field}`);
  if (parsed < 0n || parsed > MAX_CURSOR) throw new Error(`invalid ${field}`);
  return parsed;
}

export function gramWireResumeCursor(envelope: {
  type: string;
  body?: Record<string, unknown>;
}): bigint | null {
  if (envelope.type !== "ready" || envelope.body?.resume_cursor === undefined) return null;
  return asBigInt(envelope.body.resume_cursor, "resume cursor");
}

function decodeEnvelope(plaintext: Uint8Array): Envelope {
  if (plaintext.length > MAX_CIPHERTEXT) throw new Error("oversized envelope");
  const value = decode(plaintext, { useBigInt64: true });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid envelope");
  const envelope = value as Partial<Envelope>;
  if (
    envelope.v !== VERSION ||
    typeof envelope.type !== "string" ||
    envelope.type.length > 64 ||
    !envelope.body ||
    typeof envelope.body !== "object" ||
    Array.isArray(envelope.body)
  ) {
    throw new Error("invalid envelope");
  }
  asBigInt(envelope.id, "envelope id");
  return envelope as Envelope;
}

function encodeEnvelope(type: string, id: bigint, body: Record<string, unknown>) {
  return encode({ v: VERSION, type, id, body }, { useBigInt64: true });
}

function nonce(prefix: Uint8Array, sequence: bigint) {
  const output = new Uint8Array(12);
  output.set(prefix, 0);
  new DataView(output.buffer).setBigUint64(4, sequence, false);
  return output;
}

function aad(direction: 1 | 2, sequence: bigint) {
  const output = new Uint8Array(15);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint16(4, VERSION, false);
  output[6] = direction;
  view.setBigUint64(7, sequence, false);
  return output;
}

class RecordLayer {
  private sendSequence = 0n;
  private receiveSequence = 0n;

  constructor(
    private readonly sendKey: CryptoKey,
    private readonly receiveKey: CryptoKey,
    private readonly sendPrefix: Uint8Array,
    private readonly receivePrefix: Uint8Array
  ) {}

  async seal(plaintext: Uint8Array) {
    if (plaintext.length + 16 > MAX_CIPHERTEXT) throw new Error("frame too large");
    this.sendSequence += 1n;
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce(this.sendPrefix, this.sendSequence),
        additionalData: aad(1, this.sendSequence),
        tagLength: 128
      },
      this.sendKey,
      toArrayBuffer(plaintext)
    );
    return concat(
      (() => {
        const sequence = new Uint8Array(8);
        new DataView(sequence.buffer).setBigUint64(0, this.sendSequence, false);
        return sequence;
      })(),
      new Uint8Array(encrypted)
    );
  }

  async open(frame: Uint8Array) {
    if (frame.length < 24 || frame.length - 8 > MAX_CIPHERTEXT) throw new Error("invalid frame size");
    const sequence = new DataView(frame.buffer, frame.byteOffset, 8).getBigUint64(0, false);
    if (sequence !== this.receiveSequence + 1n) throw new Error("invalid frame sequence");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce(this.receivePrefix, sequence),
        additionalData: aad(2, sequence),
        tagLength: 128
      },
      this.receiveKey,
      toArrayBuffer(frame.subarray(8))
    );
    this.receiveSequence = sequence;
    return new Uint8Array(plaintext);
  }
}

class BinaryInbox {
  private readonly queued: Uint8Array[] = [];
  private readonly waiting: Array<{
    resolve: (value: Uint8Array) => void;
    reject: (reason: Error) => void;
  }> = [];
  private closed: Error | null = null;

  push(value: Uint8Array) {
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve(value);
    else this.queued.push(value);
  }

  fail(reason: Error) {
    this.closed = reason;
    for (const waiter of this.waiting.splice(0)) waiter.reject(reason);
  }

  async take(timeout = HANDSHAKE_TIMEOUT) {
    const queued = this.queued.shift();
    if (queued) return queued;
    if (this.closed) throw this.closed;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiting.push(waiter);
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error("GRAM Wire timeout"));
      }, timeout);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      waiter.reject = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };
    });
  }
}

async function createRecordLayer(clientHello: Uint8Array, serverHello: Uint8Array, keys: CryptoKeyPair) {
  if (
    serverHello.length !== SERVER_HELLO_SIZE ||
    !MAGIC.every((byte, index) => serverHello[index] === byte) ||
    new DataView(serverHello.buffer, serverHello.byteOffset).getUint16(4, false) !== VERSION
  ) {
    throw new Error("malformed server hello");
  }
  const pins = gramWireIdentityPins();
  if (pins.length === 0) throw new Error("invalid GRAM Wire identity pin");
  const transcript = concat(SIGNATURE_LABEL, clientHello, serverHello.subarray(0, 54));
  const signature = toArrayBuffer(serverHello.subarray(54));
  let verified = false;
  for (const pinValue of pins) {
    const pin = decodeBase64(pinValue);
    if (pin.length !== 32) continue;
    let identity: CryptoKey;
    try {
      identity = await crypto.subtle.importKey("raw", pin, { name: "Ed25519" }, false, ["verify"]);
    } catch {
      continue;
    }
    // Any trusted pin verifying the transcript is enough: this is how key rotation stays seamless
    // across a client/gateway version skew. Constant-time comparison is unnecessary because the
    // pins are public and the signature is over public handshake bytes.
    if (await crypto.subtle.verify({ name: "Ed25519" }, identity, signature, toArrayBuffer(transcript))) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new Error("GRAM Wire identity mismatch");

  const peer = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(serverHello.subarray(6, 38)),
    { name: "X25519" },
    false,
    []
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: peer },
    keys.privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const salt = concat(clientHello.subarray(46, 62), serverHello.subarray(38, 54));
  const material = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: HKDF_INFO
      },
      hkdfKey,
      576
    )
  );
  // A second, independently labelled HKDF expansion over the same shared secret yields the
  // channel binding the gateway also derives. It never overlaps the record-layer keys above.
  const channelBinding = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: CHANNEL_BINDING_INFO
      },
      hkdfKey,
      256
    )
  );
  const sendKey = await crypto.subtle.importKey(
    "raw",
    material.subarray(0, 32),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const receiveKey = await crypto.subtle.importKey(
    "raw",
    material.subarray(32, 64),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  return {
    records: new RecordLayer(sendKey, receiveKey, material.slice(64, 68), material.slice(68, 72)),
    channelBinding
  };
}

/** base64url(SHA-256(channelBinding)) — the exact cnf value the API embeds and the gateway checks. */
async function channelBindingConfirmation(channelBinding: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(channelBinding)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeClientHello() {
  const keys = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  if (publicKey.length !== 32) throw new Error("invalid X25519 key");
  const hello = new Uint8Array(CLIENT_HELLO_SIZE);
  hello.set(MAGIC, 0);
  const view = new DataView(hello.buffer);
  view.setUint16(4, VERSION, false);
  view.setBigUint64(6, BigInt(Math.floor(Date.now() / 1000)), false);
  hello.set(publicKey, 14);
  crypto.getRandomValues(hello.subarray(46, 62));
  return { hello, keys };
}

async function fetchTicket(channelBinding: Uint8Array) {
  const confirmation = await channelBindingConfirmation(channelBinding);
  const response = await fetch(`${API_URL}/api/auth/wire-ticket`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", "X-Gram-Wire-Channel-Binding": confirmation }
  });
  if (!response.ok) throw new Error("GRAM Wire ticket unavailable");
  const body = (await response.json()) as { ticket?: unknown };
  if (typeof body.ticket !== "string" || body.ticket.length > 4096) {
    throw new Error("invalid GRAM Wire ticket");
  }
  return body.ticket;
}

export class GramWireClient {
  private socket: WebSocket | null = null;
  private inbox: BinaryInbox | null = null;
  private records: RecordLayer | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private requestID = 0n;
  private userID = "";
  private cursor = 0n;
  private stopped = false;
  private stage = "idle";

  constructor(private readonly callbacks: GramWireCallbacks) {}

  failureStage() {
    return this.stage;
  }

  async connect() {
    if (!gramWireBrowserEnabled() || !globalThis.crypto?.subtle) {
      throw new Error("GRAM Wire unsupported");
    }
    this.stopped = false;
    this.stage = "open";
    const url =
      process.env.NEXT_PUBLIC_GRAM_WIRE_URL ?? `${API_URL.replace(/^http/, "ws")}/wire`;
    const socket = new WebSocket(url, "gram-wire-v1");
    socket.binaryType = "arraybuffer";
    const inbox = new BinaryInbox();
    this.socket = socket;
    this.inbox = inbox;
    socket.onmessage = (message) => {
      if (message.data instanceof ArrayBuffer) inbox.push(new Uint8Array(message.data));
      else inbox.fail(new Error("GRAM Wire requires binary frames"));
    };
    socket.onerror = () => inbox.fail(new Error("GRAM Wire network error"));
    socket.onclose = () => {
      inbox.fail(new Error("GRAM Wire closed"));
      const notify = !this.stopped;
      this.stopped = true;
      if (notify) this.callbacks.onDisconnect?.("transport");
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("GRAM Wire open timeout")), HANDSHAKE_TIMEOUT);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          reject(new Error("GRAM Wire closed before open"));
        },
        { once: true }
      );
    });

    this.stage = "handshake";
    const { hello, keys } = await makeClientHello();
    socket.send(hello);
    const { records, channelBinding } = await createRecordLayer(hello, await inbox.take(), keys);
    this.records = records;
    this.stage = "ticket";
    const ticket = await fetchTicket(channelBinding);
    this.stage = "authentication";
    await this.send("auth", { ticket });
    const ready = await this.receive();
    if (ready.type !== "ready" || typeof ready.body.user_id !== "string") {
      throw new Error("GRAM Wire authentication rejected");
    }
    this.userID = ready.body.user_id;
    const saved = localStorage.getItem(`gram-wire-cursor:${this.userID}`);
    try {
      this.cursor = saved ? asBigInt(saved, "saved cursor") : 0n;
    } catch {
      this.cursor = 0n;
      localStorage.removeItem(`gram-wire-cursor:${this.userID}`);
    }
    this.stage = "resume";
    await this.send("resume", { last_event_id: this.cursor });
    await this.waitForResume();
    this.stage = "active";
    this.heartbeat = setInterval(() => {
      this.send("ping", {}).catch(() => this.close());
    }, 50_000);
    void this.pump();
  }

  private async waitForResume() {
    for (;;) {
      const envelope = await this.receive();
      const resumeCursor = gramWireResumeCursor(envelope);
      if (resumeCursor !== null) {
        this.cursor = resumeCursor;
        if (this.userID) {
          localStorage.setItem(`gram-wire-cursor:${this.userID}`, this.cursor.toString());
        }
        return;
      }
      await this.handle(envelope);
    }
  }

  private async pump() {
    try {
      while (!this.stopped) await this.handle(await this.receive(80_000));
    } catch (error) {
      const notify = !this.stopped;
      this.close();
      if (notify) this.callbacks.onDisconnect?.(gramWireFailureClass(error));
    }
  }

  private async handle(envelope: Envelope) {
    if (envelope.type === "pong" || envelope.type === "ready") return;
    if (envelope.type === "resync_required") {
      await this.callbacks.onResync();
      this.cursor = 0n;
      localStorage.removeItem(`gram-wire-cursor:${this.userID}`);
      await this.send("resume", { last_event_id: 0n });
      return;
    }
    if (envelope.type === "error") {
      throw new Error("GRAM Wire protocol error");
    }
    if (envelope.type !== "event") throw new Error("unexpected GRAM Wire envelope");
    const eventID = asBigInt(envelope.body.event_id, "event id");
    const eventType = envelope.body.event_type;
    const body = envelope.body.payload;
    if (
      eventID <= this.cursor ||
      typeof eventType !== "string" ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      if (eventID <= this.cursor) return;
      throw new Error("invalid GRAM Wire event");
    }
    await this.callbacks.onEvent({ id: eventID, type: eventType, body: body as Record<string, unknown> });
    this.cursor = eventID;
    localStorage.setItem(`gram-wire-cursor:${this.userID}`, eventID.toString());
    await this.send("ack", { event_id: eventID });
  }

  private async send(type: string, body: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.records) {
      throw new Error("GRAM Wire is not connected");
    }
    this.requestID += 1n;
    const frame = await this.records.seal(encodeEnvelope(type, this.requestID, body));
    this.socket.send(frame);
  }

  private async receive(timeout?: number) {
    if (!this.inbox || !this.records) throw new Error("GRAM Wire is not connected");
    return decodeEnvelope(await this.records.open(await this.inbox.take(timeout)));
  }

  close() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const socket = this.socket;
    this.socket = null;
    this.inbox = null;
    this.records = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
  }
}
