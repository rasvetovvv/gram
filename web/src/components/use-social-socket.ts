"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/api";
import {
  GRAM_WIRE_PRIMARY,
  GramWireClient,
  gramWireBrowserEnabled,
  gramWireFailureClass,
  gramWireSocialEventType
} from "@/lib/gram-wire";

/**
 * One social socket per browser tab, shared by every screen that wants live updates.
 *
 * The feed, a post's comment thread and the counters under a card all want the same stream of
 * "something changed" frames. Opening a socket per component would mean four connections doing
 * one job, so the connection lives here as a module singleton and components only subscribe.
 *
 * A frame is deliberately thin — an event name and the ids involved — so nothing here has to
 * know what a post looks like. Subscribers decide whether to patch, refetch, or wait.
 */
export type SocialEvent = {
  type: string;
  post_id?: string;
  comment_id?: string;
  actor_id?: string;
  /**
   * Set on `chat_activity`: a conversation this account belongs to has moved.
   *
   * Chat frames are delivered to the members of that chat and to nobody else — the existence of a
   * conversation is not public the way a like on a post is.
   */
  chat_id?: string;
};

type Listener = (event: SocialEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let wire: GramWireClient | null = null;
let wireConnecting = false;
let wireFallback = false;
let wireGeneration = 0;
let idleTeardown: ReturnType<typeof setTimeout> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let attempts = 0;
/** Set once the server refuses the credentials, so a logged-out tab stops dialling. */
let refused = false;

function emit(frame: SocialEvent) {
  listeners.forEach((listener) => {
    try {
      listener(frame);
    } catch {
      // One broken subscriber must not silence the rest.
    }
  });
}

function teardownLegacy() {
  if (retry) clearTimeout(retry);
  retry = undefined;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
  const current = socket;
  socket = null;
  if (current) {
    current.onclose = null;
    current.onmessage = null;
    current.onopen = null;
    current.close();
  }
}

function teardown() {
  if (idleTeardown) clearTimeout(idleTeardown);
  idleTeardown = undefined;
  wireGeneration += 1;
  teardownLegacy();
  wire?.close();
  wire = null;
  wireConnecting = false;
  wireFallback = false;
}

function connectLegacy() {
  if (typeof window === "undefined" || refused || socket || !listeners.size) return;
  const url = `${API_URL.replace(/^http/, "ws")}/ws/social`;
  const next = new WebSocket(url);
  socket = next;

  next.onopen = () => {
    attempts = 0;
    // The server bounds session lifetime on a ping, and an idle socket behind a proxy is a
    // socket about to be cut; one ping a minute answers both.
    heartbeat = setInterval(() => {
      if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: "ping" }));
    }, 55_000);
  };

  next.onmessage = (event) => {
    let frame: SocialEvent;
    try {
      frame = JSON.parse(event.data) as SocialEvent;
    } catch {
      return;
    }
    if (frame.type === "ready" || frame.type === "pong") return;
    emit(frame);
  };

  next.onclose = (event) => {
    if (socket !== next) return;
    teardownLegacy();
    // 4401/4403 mean "not you" rather than "not now": reconnecting would only repeat the refusal.
    if (event.code === 4401 || event.code === 4403) {
      refused = true;
      return;
    }
    if (!listeners.size) return;
    attempts += 1;
    retry = setTimeout(connectLegacy, Math.min(1000 * 2 ** attempts, 20_000));
  };
}

function connect() {
  if (idleTeardown) clearTimeout(idleTeardown);
  idleTeardown = undefined;
  if (typeof window === "undefined" || refused || !listeners.size || wire || wireConnecting) return;
  if (!gramWireBrowserEnabled() || wireFallback) {
    connectLegacy();
    return;
  }
  // Until every legacy social event has an outbox equivalent, Wire runs in shadow mode and
  // legacy remains authoritative. PRIMARY is an explicit post-parity rollout switch.
  if (!GRAM_WIRE_PRIMARY) connectLegacy();
  const generation = ++wireGeneration;
  wireConnecting = true;
  const candidate = new GramWireClient({
    onEvent: (event) => {
      if (wireGeneration !== generation) return;
      const social: SocialEvent = { type: event.type };
      for (const field of ["post_id", "comment_id", "actor_id", "chat_id"] as const) {
        const value = event.body[field];
        if (typeof value === "string") social[field] = value;
      }
      social.type = gramWireSocialEventType(event.type);
      emit(social);
    },
    onResync: () => {
      if (wireGeneration === generation) emit({ type: "chat_activity" });
    },
    onDisconnect: (reason) => {
      if (wireGeneration !== generation || wire !== candidate) return;
      sessionStorage.setItem("gram-wire-last-failure", `${candidate.failureStage()}:${reason}`);
      wire = null;
      wireFallback = true;
      if (listeners.size) connectLegacy();
    }
  });
  wire = candidate;
  candidate
    .connect()
    .then(() => {
      if (wireGeneration !== generation) {
        candidate.close();
        return;
      }
      wireConnecting = false;
      if (wire !== candidate) return;
      if (!listeners.size) {
        wire = null;
        candidate.close();
        return;
      }
      if (GRAM_WIRE_PRIMARY) teardownLegacy();
      sessionStorage.removeItem("gram-wire-last-failure");
      attempts = 0;
    })
    .catch((error: unknown) => {
      candidate.close();
      if (wireGeneration !== generation) return;
      sessionStorage.setItem(
        "gram-wire-last-failure",
        `${candidate.failureStage()}:${gramWireFailureClass(error)}`
      );
      if (wire === candidate) wire = null;
      wireConnecting = false;
      wireFallback = true;
      if (listeners.size) connectLegacy();
    });
}

/**
 * Subscribe to the shared social stream.
 *
 * The callback is kept in a ref-free set on purpose: pass a `useCallback`-stable handler, or
 * accept that a re-created handler re-subscribes (which is cheap — the socket is not touched).
 */
export function useSocialEvents(onEvent: Listener) {
  useEffect(() => {
    listeners.add(onEvent);
    connect();
    return () => {
      listeners.delete(onEvent);
      // Delay one task: React strict-mode probes and route transitions unsubscribe/re-subscribe in
      // the same turn and must not tear down a healthy encrypted session between those callbacks.
      if (!listeners.size) {
        idleTeardown = setTimeout(() => {
          idleTeardown = undefined;
          if (!listeners.size) teardown();
        }, 0);
      }
    };
  }, [onEvent]);
}

/**
 * Signing in again after a refusal should not need a reload.
 *
 * The auth screens call this so the next mount dials afresh instead of staying convinced it is
 * unwelcome.
 */
export function resetSocialSocket() {
  refused = false;
  attempts = 0;
  teardown();
  connect();
}
