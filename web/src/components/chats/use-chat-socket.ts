"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { API_URL, api } from "@/lib/api";
import type { Message } from "@/lib/types";

/**
 * Live conversation updates over the socket the API already exposes.
 *
 * Polling alone made a reply take up to eight seconds to appear, which read as "you have to
 * re-open the chat". The socket patches the cache directly; the poll stays as the fallback
 * for a dropped connection, so a missed frame still heals itself.
 */
export function useChatSocket(chatId: string | undefined) {
  const queryClient = useQueryClient();
  // A frame is viewer-neutral by design, so "is this mine" is answered here, not by the
  // server: one broadcast reaches every member and cannot know who each of them is.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const myId = me?.id;

  useEffect(() => {
    if (!chatId) return;
    const url = `${API_URL.replace(/^http/, "ws")}/ws/chats/${chatId}`;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;

    const patch = (incoming: Message) => {
      const owned: Message = { ...incoming, is_mine: incoming.sender_id === myId };
      queryClient.setQueryData<Message[]>(["messages", chatId], (current) => {
        if (!current) return current;
        const index = current.findIndex((item) => item.id === owned.id);
        if (index >= 0) {
          const next = current.slice();
          // `read` is the sender's business and arrives blank; keep what the last poll knew.
          next[index] = { ...next[index], ...owned, read: next[index].read };
          return next;
        }
        return [...current, owned];
      });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const drop = (messageId: string) => {
      queryClient.setQueryData<Message[]>(["messages", chatId], (current) =>
        current?.filter((item) => item.id !== messageId)
      );
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(url);
      socket.onopen = () => {
        attempts = 0;
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as {
            type: string;
            message?: Message;
            message_id?: string;
          };
          if (frame.type === "message_deleted" && frame.message_id) {
            drop(frame.message_id);
          } else if (frame.type === "message_reacted") {
            // Whose reaction is whose cannot be read off a neutral frame, so this one refetches.
            queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
          } else if (frame.message) {
            patch(frame.message);
          }
        } catch {
          // A frame we cannot read is not worth tearing the socket down for; the poll covers it.
        }
      };
      socket.onclose = () => {
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
      socket?.close();
    };
  }, [chatId, myId, queryClient]);
}
