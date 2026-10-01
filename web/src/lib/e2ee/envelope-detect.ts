// Cheap, allocation-free guards for "is this message body an E2EE wire envelope?".
//
// Used by the UI render path so a NON-envelope body (our own just-sent row that was already folded
// to plaintext, a plain service line, or legacy plaintext in an old secret chat) is shown directly
// instead of being masked with a lock placeholder. The authoritative decode still happens in the
// e2ee manager; this only decides whether to show "🔒 …" while a real ciphertext is pending.

/** A 1:1 Double-Ratchet envelope: a JSON object carrying a base64 `ct` and a ratchet `dh` key. */
export function looksLikeEnvelope(body: string | undefined): boolean {
  if (!body || body.charCodeAt(0) !== 123 /* { */) return false;
  return /"ct"\s*:/.test(body) && /"dh"\s*:/.test(body);
}

/** A group sender-key message envelope: tagged `"t":"gmsg"` with a `ct`. */
export function looksLikeGroupEnvelope(body: string | undefined): boolean {
  if (!body || body.charCodeAt(0) !== 123 /* { */) return false;
  return /"t"\s*:\s*"gmsg"/.test(body) && /"ct"\s*:/.test(body);
}
