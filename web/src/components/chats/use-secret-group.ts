"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Chat, Message } from "@/lib/types";
import { e2eeManager } from "@/lib/e2ee/manager";
import { GROUP_KEY_DISTRIBUTION_MARKER } from "@/lib/e2ee/group-wire";

/**
 * Wires a SECRET GROUP (is_group && is_secret) to the sender-key E2EE engine.
 *
 * Each member owns a sender key; its PUBLIC half is distributed to every other member over that
 * member's pairwise 1:1 secret channel (api.secretChat + the pairwise ratchet). Thereafter a
 * member encrypts each message once and the server fans the single ciphertext out. This hook:
 *   - on open, ensures this browser has a device and hands our sender key to members who lack it;
 *   - decrypts inbound group ciphertext per sender (showing a "waiting for key" marker until that
 *     sender's key has arrived over the pairwise channel);
 *   - encrypts outgoing text into the group wire envelope before send.
 *
 * For any non-secret-group chat it is a transparent pass-through (isSecretGroup === false).
 */
export function useSecretGroup(
  activeChat: Chat | undefined,
  currentUserId: string | undefined,
  messages: Message[]
) {
  const isSecretGroup = Boolean(activeChat?.is_group && activeChat?.is_secret);
  const chatId = activeChat?.id;

  const [plaintextById, setPlaintextById] = useState<Record<string, string>>({});
  const decryptingRef = useRef<Set<string>>(new Set());

  // The group's members, needed both to distribute our key and to attribute inbound senders.
  const info = useQuery({
    queryKey: ["chat-info", chatId],
    queryFn: () => api.chatInfo(chatId!),
    enabled: isSecretGroup && Boolean(chatId)
  });
  const members = useMemo(() => info.data?.members ?? [], [info.data?.members]);
  // The member-id set we last distributed to, so a shrink (someone left) triggers a key rotation
  // before the next hand-out. A grow (someone joined) only needs a hand-out, not a rotation.
  const lastMemberIdsRef = useRef<Set<string> | null>(null);

  // Distribute our sender key to every member who does not already hold it, over their pairwise
  // 1:1 secret channel. Runs when the group opens and whenever its membership changes. If a member
  // left since last time, rotate our sender key first so the departed member cannot read what we
  // send next, then re-distribute the fresh key to everyone still here.
  useEffect(() => {
    if (!isSecretGroup || !currentUserId || !chatId || members.length === 0) return;
    let cancelled = false;
    (async () => {
      const manager = e2eeManager(currentUserId);
      await manager.ensureDevice();
      const peers = members.map((m) => m.user).filter((u) => u.id !== currentUserId);
      const byId = new Map(peers.map((u) => [u.id, u.username] as const));
      const currentIds = new Set(members.map((m) => m.user.id));

      // A member left if the previous set had someone the current set no longer does.
      const previous = lastMemberIdsRef.current;
      const someoneLeft =
        previous !== null && [...previous].some((id) => !currentIds.has(id));
      if (someoneLeft) {
        try {
          await manager.rotateGroupOnMembershipChange(chatId);
        } catch {
          /* rotation failure is retried on the next membership change */
        }
      }
      lastMemberIdsRef.current = currentIds;

      try {
        await manager.distributeGroupKeys(
          chatId,
          currentUserId,
          byId.keys(),
          async (peerUserId, wire) => {
            const username = byId.get(peerUserId);
            if (!username) throw new Error("e2ee: unknown group member");
            // Open (or reuse) the pairwise secret chat with this peer, then send our group key
            // through it encrypted end to end — the server never sees the key.
            const secretChat = await api.secretChat(username);
            const encrypted = await manager.encrypt(secretChat.id, username, wire);
            await api.sendMessage(secretChat.id, encrypted);
          }
        );
      } catch {
        /* a failed hand-off is retried on the next open; surfaced via undecryptable bubbles */
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [isSecretGroup, currentUserId, chatId, members]);

  // Decrypt inbound group ciphertext we have not decrypted yet.
  useEffect(() => {
    if (!isSecretGroup || !currentUserId || !chatId) return;
    const manager = e2eeManager(currentUserId);
    let cancelled = false;
    (async () => {
      for (const message of messages) {
        if (message.service) continue;
        if (message.pending) continue; // optimistic bubble already holds plaintext
        if (plaintextById[message.id] !== undefined) continue;
        if (decryptingRef.current.has(message.id)) continue;
        decryptingRef.current.add(message.id);
        try {
          const plaintext = await manager.decryptGroup(chatId, message.sender_id, message.content);
          if (!cancelled) setPlaintextById((prev) => ({ ...prev, [message.id]: plaintext }));
        } catch {
          // Most often: this sender's key has not reached us yet over the pairwise channel.
          if (!cancelled) {
            setPlaintextById((prev) => ({
              ...prev,
              [message.id]: "🔒 Ожидание ключа отправителя…"
            }));
          }
        } finally {
          decryptingRef.current.delete(message.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSecretGroup, currentUserId, chatId, messages, plaintextById]);

  // Replace ciphertext with the decrypted body for rendering; hide a key-handshake message
  // entirely (it is plumbing that arrived in the thread, not something anyone wrote).
  const displayMessages = useMemo(() => {
    if (!isSecretGroup) return messages;
    return messages
      .map((message) => {
        if (message.service) return message;
        if (message.pending) return message; // optimistic bubble already holds plaintext
        const plaintext = plaintextById[message.id];
        if (plaintext === undefined) return { ...message, content: "🔒 …" };
        return { ...message, content: plaintext };
      })
      .filter((message) => message.content !== GROUP_KEY_DISTRIBUTION_MARKER);
  }, [isSecretGroup, messages, plaintextById]);

  /** Encrypt outgoing text into the group wire envelope. Returns text unchanged for other chats. */
  const encryptForSend = useCallback(
    async (text: string): Promise<string> => {
      if (!isSecretGroup || !currentUserId || !chatId) return text;
      return e2eeManager(currentUserId).encryptGroup(chatId, currentUserId, text);
    },
    [isSecretGroup, currentUserId, chatId]
  );

  return { isSecretGroup, displayMessages, encryptForSend };
}
