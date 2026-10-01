"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chat, Message } from "@/lib/types";
import { e2eeManager } from "@/lib/e2ee/manager";
import type { VerificationStatus } from "@/lib/e2ee/fingerprint";
import { looksLikeEnvelope } from "@/lib/e2ee/envelope-detect";

/** Device-wide key health, surfaced read-only in the secret-chat security sheet. */
export interface KeyHealth {
  oneTimePreKeys: number;
  target: number;
  lowThreshold: number;
  low: boolean;
  signedPreKeyAgeDays: number;
  signedPreKeyMaxAgeDays: number;
}

/**
 * Wires a secret chat to the E2EE engine. For a chat whose `kind` is `secret`, message bodies on
 * the wire are ciphertext envelopes; this hook decrypts them for display and encrypts outgoing
 * text before it is sent. For any other chat it is a transparent pass-through.
 *
 * All key material stays on the device (see lib/e2ee/vault). The server only ever relays the
 * ciphertext and the public prekey directory.
 */
export function useSecretChat(
  activeChat: Chat | undefined,
  currentUserId: string | undefined,
  messages: Message[]
) {
  // A 1:1 secret chat (kind) and a secret GROUP (is_secret flag) are both end-to-end encrypted,
  // but use different engines: the 1:1 pairwise ratchet here, the group sender-key path in
  // useSecretGroup. This hook owns ONLY the 1:1 case so the two never cross wires.
  const isSecret = activeChat?.kind === "secret" && !activeChat?.is_group;
  const chatId = activeChat?.id;
  const peerUsername = activeChat?.participant?.username;

  // messageId -> decrypted plaintext (or a marker when it could not be decrypted on this device).
  const [plaintextById, setPlaintextById] = useState<Record<string, string>>({});
  const decryptingRef = useRef<Set<string>>(new Set());
  // The safety number for this chat, recomputed whenever a session first appears or its keys change.
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [safetyQr, setSafetyQr] = useState<string | null>(null);
  // Whether the user confirmed the peer's key, and whether it still matches ("changed" = warn).
  const [verification, setVerification] = useState<VerificationStatus>("unverified");
  // Bumped by markVerified/reVerify so the status effect re-reads the persisted trust state.
  const [verifyEpoch, setVerifyEpoch] = useState(0);
  // This device's key-material health (prekey pool + signed-prekey age), for the security sheet.
  const [keyHealth, setKeyHealth] = useState<KeyHealth | null>(null);

  // Ensure this browser has a published device as soon as a secret chat is opened.
  useEffect(() => {
    if (!isSecret || !currentUserId) return;
    e2eeManager(currentUserId)
      .ensureDevice()
      .catch(() => {
        /* surfaced to the user through undecryptable bubbles rather than a crash */
      });
  }, [isSecret, currentUserId, chatId]);

  // Decrypt any inbound envelopes we have not decrypted yet.
  useEffect(() => {
    if (!isSecret || !currentUserId || !chatId) return;
    const manager = e2eeManager(currentUserId);
    let cancelled = false;
    (async () => {
      for (const message of messages) {
        if (message.service) continue;
        // A pending optimistic bubble already holds the typed plaintext; it has no ciphertext to
        // decrypt and must not be masked.
        if (message.pending) continue;
        if (plaintextById[message.id] !== undefined) continue;
        if (decryptingRef.current.has(message.id)) continue;
        decryptingRef.current.add(message.id);
        try {
          const plaintext = await manager.decrypt(chatId, message.content);
          if (!cancelled) setPlaintextById((prev) => ({ ...prev, [message.id]: plaintext }));
        } catch {
          if (!cancelled) {
            setPlaintextById((prev) => ({
              ...prev,
              [message.id]: "🔒 Не удалось расшифровать на этом устройстве"
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
  }, [isSecret, currentUserId, chatId, messages, plaintextById]);

  // Recompute the safety number whenever the session may have changed (a message arrived or the
  // chat switched). It becomes available only after a session exists on this device, so this
  // settles from null to a value once the first message has been sent or received.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSecret || !currentUserId || !chatId) {
        if (!cancelled) {
          setSafetyNumber(null);
          setSafetyQr(null);
          setVerification("unverified");
        }
        return;
      }
      const manager = e2eeManager(currentUserId);
      try {
        const [number, qr, status, health] = await Promise.all([
          manager.safetyNumber(chatId),
          manager.safetyNumberQr(chatId),
          manager.verificationStatus(chatId),
          manager.keyHealth()
        ]);
        if (!cancelled) {
          setSafetyNumber(number);
          setSafetyQr(qr);
          setVerification(status);
          setKeyHealth(health);
        }
      } catch {
        if (!cancelled) {
          setSafetyNumber(null);
          setSafetyQr(null);
          setVerification("unverified");
          setKeyHealth(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSecret, currentUserId, chatId, messages, verifyEpoch]);

  // Replace ciphertext with the decrypted body for rendering, leaving service messages untouched.
  const displayMessages = useMemo(() => {
    if (!isSecret) return messages;
    return messages.map((message) => {
      if (message.service) return message;
      // A pending optimistic bubble is already the typed plaintext — show it as-is, never mask it.
      if (message.pending) return message;
      const plaintext = plaintextById[message.id];
      if (plaintext !== undefined) return { ...message, content: plaintext };
      // Only an undecrypted CIPHERTEXT envelope gets the lock placeholder. A body that is not an
      // envelope (our own just-sent row, already folded to plaintext; a plain service line) is
      // shown directly, so the sender never sees a "🔒 …" flash on a message they just wrote.
      return looksLikeEnvelope(message.content)
        ? { ...message, content: "🔒 …" }
        : message;
    });
  }, [isSecret, messages, plaintextById]);

  /** Encrypt outgoing text for the wire. Returns the text unchanged for non-secret chats. */
  const encryptForSend = useCallback(
    async (text: string): Promise<string> => {
      if (!isSecret || !currentUserId || !chatId || !peerUsername) return text;
      return e2eeManager(currentUserId).encrypt(chatId, peerUsername, text);
    },
    [isSecret, currentUserId, chatId, peerUsername]
  );

  /** Confirm the peer's current key as verified (the safety number matched out of band). */
  const markVerified = useCallback(async () => {
    if (!currentUserId || !chatId) return;
    await e2eeManager(currentUserId).markVerified(chatId);
    setVerifyEpoch((epoch) => epoch + 1);
  }, [currentUserId, chatId]);

  /** Drop a previous verification so the user can re-confirm (e.g. after a key change). */
  const reVerify = useCallback(async () => {
    if (!currentUserId || !chatId) return;
    await e2eeManager(currentUserId).clearVerification(chatId);
    setVerifyEpoch((epoch) => epoch + 1);
  }, [currentUserId, chatId]);

  return {
    isSecret,
    displayMessages,
    encryptForSend,
    safetyNumber,
    safetyQr,
    verification,
    markVerified,
    reVerify,
    keyHealth
  };
}
