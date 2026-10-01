"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chat, Message } from "@/lib/types";
import { e2eeManager } from "@/lib/e2ee/manager";
import type { VerificationStatus } from "@/lib/e2ee/fingerprint";

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
  const isSecret = activeChat?.kind === "secret";
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
        const [number, qr, status] = await Promise.all([
          manager.safetyNumber(chatId),
          manager.safetyNumberQr(chatId),
          manager.verificationStatus(chatId)
        ]);
        if (!cancelled) {
          setSafetyNumber(number);
          setSafetyQr(qr);
          setVerification(status);
        }
      } catch {
        if (!cancelled) {
          setSafetyNumber(null);
          setSafetyQr(null);
          setVerification("unverified");
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
      const plaintext = plaintextById[message.id];
      return plaintext === undefined ? { ...message, content: "🔒 …" } : { ...message, content: plaintext };
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
    reVerify
  };
}
