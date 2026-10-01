import type { Message } from "@/lib/types";
import { looksLikeEnvelope, looksLikeGroupEnvelope } from "@/lib/e2ee/envelope-detect";

/** True for an E2EE ciphertext body (1:1 ratchet envelope or group sender-key envelope). */
function isCiphertextBody(body: string | undefined): boolean {
  return looksLikeEnvelope(body) || looksLikeGroupEnvelope(body);
}

/**
 * Fold one message into a cached thread, optimistic rows included.
 *
 * A message I sent appears twice unless something reconciles the two copies: once as the
 * optimistic bubble drawn on submit, and again as the server's row arriving over the socket or
 * from the mutation's response. They carry different ids, so identity is re-established by
 * content: the pending row is *replaced* rather than appended to, and its `client_key` is
 * carried onto the server row so the list keeps drawing it under the same key. Without that the
 * swap is an unmount plus a remount, and the bubble visibly blinks.
 *
 * Secret chats complicate this: the optimistic bubble holds PLAINTEXT while the server echo holds
 * the CIPHERTEXT envelope, so a content match never succeeds. Own messages are sent and echoed in
 * order, so the oldest still-pending own row is reconciled instead, and the optimistic plaintext
 * is kept as the visible body so the bubble never flashes ciphertext before the decrypt catches up.
 */
export function mergeMessage(current: Message[], incoming: Message): Message[] {
  const index = current.findIndex((item) => item.id === incoming.id);
  if (index >= 0) {
    const existing = current[index];
    // Guard against re-ciphering a row we already folded to plaintext: when a later copy of the
    // SAME message (socket echo, poll) arrives carrying the ciphertext envelope, keep the plaintext
    // body we are already showing. Otherwise the bubble flips back to "🔒 …" after the first decrypt.
    const keepBody = isCiphertextBody(incoming.content) && !isCiphertextBody(existing.content);
    const next = current.slice();
    next[index] = {
      ...existing,
      ...incoming,
      content: keepBody ? existing.content : incoming.content,
      // `read` is the sender's business and can arrive blank; keep what the last poll knew.
      read: incoming.read ?? existing.read,
      client_key: existing.client_key ?? incoming.client_key,
      pending: false
    };
    return next;
  }
  if (incoming.is_mine) {
    const text = incoming.content.trim();
    // Plaintext chats: the optimistic bubble and the echo carry the same text, so match on it.
    let waiting = current.findIndex(
      (item) => item.pending && item.is_mine && item.content.trim() === text
    );
    // Secret chats: no content match is possible (plaintext vs ciphertext). Reconcile the oldest
    // still-pending own row — this stops a secret message appearing twice and flickering.
    if (waiting < 0) {
      waiting = current.findIndex((item) => item.pending && item.is_mine);
    }
    if (waiting >= 0) {
      const next = current.slice();
      next[waiting] = {
        ...incoming,
        // Keep the optimistic plaintext visible: `messages` would otherwise briefly hold the
        // ciphertext for this id until the per-message decrypt effect runs — the "🔒 …" flash.
        // The persisted own-plaintext store keeps it stable across a reload too.
        content: current[waiting].content,
        client_key: current[waiting].client_key ?? incoming.client_key,
        pending: false
      };
      return next;
    }
  }
  return [...current, { ...incoming, pending: false }];
}
