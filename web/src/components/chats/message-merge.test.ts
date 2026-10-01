import { describe, expect, it } from "vitest";
import { mergeMessage } from "./message-merge";
import type { Message } from "@/lib/types";

function msg(partial: Partial<Message>): Message {
  return {
    id: partial.id ?? "x",
    chat_id: "c",
    sender_id: partial.sender_id ?? "me",
    sender: { id: partial.sender_id ?? "me" } as Message["sender"],
    content: partial.content ?? "",
    created_at: partial.created_at ?? new Date().toISOString(),
    is_mine: partial.is_mine ?? true,
    ...partial
  } as Message;
}

describe("mergeMessage reconciliation", () => {
  it("replaces a pending plaintext bubble with the server row by matching text", () => {
    const pending = msg({ id: "pending-1", client_key: "ck1", pending: true, content: "hello" });
    const echo = msg({ id: "srv-1", content: "hello" });
    const out = mergeMessage([pending], echo);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("srv-1");
    expect(out[0].pending).toBe(false);
    expect(out[0].client_key).toBe("ck1"); // key carried over so React doesn't remount (no blink)
  });

  it("reconciles a secret message where the echo is CIPHERTEXT, keeping the plaintext bubble", () => {
    // The optimistic bubble holds the typed plaintext; the server echoes the ciphertext envelope.
    const pending = msg({ id: "pending-2", client_key: "ck2", pending: true, content: "secret text" });
    const echo = msg({ id: "srv-2", content: '{"v":1,"dh":"abc","pn":0,"n":0,"ct":"zzzz"}' });
    const out = mergeMessage([pending], echo);
    expect(out).toHaveLength(1); // not duplicated
    expect(out[0].id).toBe("srv-2"); // adopts the real server id
    expect(out[0].pending).toBe(false);
    expect(out[0].content).toBe("secret text"); // keeps plaintext, never flashes ciphertext
    expect(out[0].client_key).toBe("ck2");
  });

  it("updates an existing row in place by id without duplicating", () => {
    const existing = msg({ id: "srv-3", content: "ciphertext", read: false });
    const update = msg({ id: "srv-3", content: "ciphertext", read: true });
    const out = mergeMessage([existing], update);
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe(true);
  });

  it("a ciphertext echo does NOT overwrite an already-plaintext-folded row by id", () => {
    // The row was folded to plaintext on send; the socket then echoes the SAME id with ciphertext.
    const folded = msg({ id: "srv-x", content: "привет секрет", client_key: "ck" });
    const echo = msg({ id: "srv-x", content: '{"v":1,"dh":"abc","pn":0,"n":0,"ct":"zzzz"}', read: true });
    const out = mergeMessage([folded], echo);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("привет секрет"); // keeps plaintext, no "🔒 …" flip
    expect(out[0].read).toBe(true); // but still absorbs the read receipt
  });

  it("appends an inbound message from someone else", () => {
    const mine = msg({ id: "srv-4", content: "hi", is_mine: true });
    const theirs = msg({ id: "srv-5", content: "yo", is_mine: false, sender_id: "bob" });
    const out = mergeMessage([mine], theirs);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("srv-5");
  });
});
