"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, api } from "@/lib/api";
import type { Message } from "@/lib/types";
import { mergeMessage } from "./message-merge";

// Re-exported so existing imports (`import { mergeMessage } from "./use-chat-socket"`) keep working
// while the pure, dependency-free logic lives in message-merge.ts where it can be unit-tested
// without pulling in the `@/lib/api` client this module depends on.
export { mergeMessage };

/** Who is typing right now, as the strip under the header reads it. */
export type TypingPeer = { userId: string; displayName: string };

/** How long a typing hint stands before it is assumed stale. */
const TYPING_TTL = 3200;
/** And how often one is sent while somebody keeps typing. */
const TYPING_THROTTLE = 2200;

/**
 * Live conversation updates over the socket the API already exposes.
 *
 * Polling alone made a reply take up to eight seconds to appear, which read as "you have to
 * re-open the chat". The socket patches the cache directly; the poll stays as the fallback
 * for a dropped connection, so a missed frame still heals itself.
 *
 * Three things travel the other way, and each one closes a gap that polling could not:
 *
 * - **read receipts.** Fetching the thread is what marks it read, so a message that arrived while
 *   the thread was *already open* stayed unread for as long as the reader kept looking at it — the
 *   badge in the list disagreed with what was on screen. Every arriving message now answers with
 *   a receipt, and the sender's tick doubles the moment it lands rather than on their next poll.
 * - **typing.** Sent while somebody writes, forgotten a moment later, never stored.
 * - **the keepalive**, which the server now answers instead of rejecting.
 */
export function useChatSocket(chatId: string | undefined) {
  const queryClient = useQueryClient();
  // A frame is viewer-neutral by design, so "is this mine" is answered here, not by the
  // server: one broadcast reaches every member and cannot know who each of them is.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const myId = me?.id;
  const [typing, setTyping] = useState<TypingPeer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Send a frame if the socket is up. Returns whether it went. */
  const send = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  /**
   * Tell the chat this reader has caught up.
   *
   * Over the socket when it is up — this fires on every arriving message, and a round trip each
   * time would be waste — and over HTTP when it is not, so a dropped connection does not leave a
   * badge lit on a conversation the reader is looking at.
   */
  const markRead = useCallback(() => {
    if (!chatId) return;
    if (send({ type: "read" })) return;
    api.markChatRead(chatId).catch(() => {
      // A failed receipt is not worth a message to the reader: the next open marks it anyway.
    });
  }, [chatId, send]);

  /** Throttled: one hint every couple of seconds is enough to keep the strip alive. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE) return;
    lastTypingSent.current = now;
    send({ type: "typing" });
  }, [send]);

  useEffect(() => {
    if (!chatId) return;
    const url = `${API_URL.replace(/^http/, "ws")}/ws/chats/${chatId}`;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let closed = false;

    const patch = (incoming: Message) => {
      const owned: Message = { ...incoming, is_mine: incoming.sender_id === myId };
      queryClient.setQueryData<Message[]>(["messages", chatId], (current) => {
        if (!current) return current;
        return mergeMessage(current, owned);
      });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      // Somebody else's message, seen by a reader who has this conversation open and this tab in
      // front of them: that is what "read" means, so say so instead of waiting for a re-open.
      if (!owned.is_mine && typeof document !== "undefined" && !document.hidden) {
        send({ type: "read" });
      }
    };

    const drop = (messageId: string) => {
      queryClient.setQueryData<Message[]>(["messages", chatId], (current) =>
        current?.filter((item) => item.id !== messageId)
      );
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    /** Somebody read up to `at`: every message of mine older than that now has two ticks. */
    const readUpTo = (at: string | undefined) => {
      const boundary = at ? new Date(at).getTime() : Date.now();
      queryClient.setQueryData<Message[]>(["messages", chatId], (current) =>
        current?.map((item) =>
          item.is_mine && !item.read && new Date(item.created_at).getTime() <= boundary
            ? { ...item, read: true }
            : item
        )
      );
    };

    const showTyping = (peer: TypingPeer) => {
      setTyping(peer);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      // Nothing says "stopped typing", so the hint expires on its own.
      typingTimer.current = setTimeout(() => setTyping(null), TYPING_TTL);
    };

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        attempts = 0;
        // An idle socket behind a proxy is a socket about to be cut.
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
        }, 50_000);
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as {
            type: string;
            message?: Message;
            message_id?: string;
            user_id?: string;
            display_name?: string;
            at?: string;
          };
          if (frame.type === "pong" || frame.type === "ready") return;
          if (frame.type === "typing") {
            if (frame.user_id && frame.user_id !== myId) {
              showTyping({ userId: frame.user_id, displayName: frame.display_name ?? "Someone" });
            }
            return;
          }
          if (frame.type === "chat_read") {
            if (frame.user_id !== myId) readUpTo(frame.at);
            return;
          }
          if (frame.type === "message_deleted" && frame.message_id) {
            drop(frame.message_id);
          } else if (frame.type === "message_reacted") {
            // Whose reaction is whose cannot be read off a neutral frame, so this one refetches.
            queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
          } else if (frame.message) {
            // A message from the person who was typing answers the question the hint asked.
            if (frame.message.sender_id !== myId) setTyping(null);
            patch(frame.message);
          }
        } catch {
          // A frame we cannot read is not worth tearing the socket down for; the poll covers it.
        }
      };
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        // Back off so a server restart does not turn into a reconnect storm.
        attempts += 1;
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15_000));
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (heartbeat) clearInterval(heartbeat);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setTyping(null);
      socketRef.current = null;
      socket?.close();
    };
  }, [chatId, myId, queryClient, send]);

  // A conversation left open in a background tab is not being read. Coming back to it is.
  useEffect(() => {
    if (!chatId) return;
    const onVisible = () => {
      if (!document.hidden) markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chatId, markRead]);

  return { typing, notifyTyping, markRead };
}
