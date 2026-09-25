import { afterEach, describe, expect, it } from "vitest";
import {
  gramWireFailureClass,
  gramWireIdentityPins,
  gramWireResumeCursor,
  gramWireRolloutAllowsBrowser,
  gramWireSocialEventType
} from "./gram-wire";

describe("GRAM Wire browser protocol contract", () => {
  it("accepts the server resume_cursor response and not the obsolete resume boolean", () => {
    expect(
      gramWireResumeCursor({ type: "ready", body: { resume_cursor: 42n } })
    ).toBe(42n);
    expect(
      gramWireResumeCursor({ type: "ready", body: { resume_cursor: 0 } })
    ).toBe(0n);
    expect(gramWireResumeCursor({ type: "ready", body: { resume: true } })).toBeNull();
  });

  it("rejects cursors outside Redis signed sequence range", () => {
    expect(() =>
      gramWireResumeCursor({
        type: "ready",
        body: { resume_cursor: 9_223_372_036_854_775_808n }
      })
    ).toThrow("invalid resume cursor");
  });

  it("keeps diagnostics coarse and payload-free", () => {
    expect(gramWireFailureClass(new Error("GRAM Wire ticket request failed"))).toBe(
      "authentication"
    );
    expect(gramWireFailureClass(new Error("invalid envelope"))).toBe("protocol");
    expect(gramWireFailureClass(new Error("secret payload value"))).toBe("internal");
  });

  it("keeps Wire disabled unless an explicitly canary-only browser opts in", () => {
    expect(gramWireRolloutAllowsBrowser(false, true, "1")).toBe(false);
    expect(gramWireRolloutAllowsBrowser(true, true, null)).toBe(false);
    expect(gramWireRolloutAllowsBrowser(true, true, "0")).toBe(false);
    expect(gramWireRolloutAllowsBrowser(true, true, "1")).toBe(true);
    expect(gramWireRolloutAllowsBrowser(true, false, null)).toBe(true);
  });

  it("maps every durable chat event to the existing chat_activity contract", () => {
    for (const eventType of [
      "chat.message_created",
      "chat.message_edited",
      "chat.message_deleted",
      "chat.message_reacted",
      "chat.message_pinned",
      "chat.read"
    ]) {
      expect(gramWireSocialEventType(eventType)).toBe("chat_activity");
    }
    expect(gramWireSocialEventType("post_updated")).toBe("post_updated");
  });

  it("passes every durable social event through under the name the screens listen for", () => {
    // feed-view and post-comments switch on these exact strings, so a Wire frame has to arrive
    // spelled the same way the legacy socket spelled it or the screen silently ignores it.
    for (const eventType of [
      "post_created",
      "post_updated",
      "post_deleted",
      "post_reacted",
      "comment_created",
      "comment_updated",
      "comment_deleted",
      "comment_reacted"
    ]) {
      expect(gramWireSocialEventType(eventType)).toBe(eventType);
    }
  });

  it("trusts the primary identity pin plus every rotated pin, newest first, deduplicated", () => {
    const primary = process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64;
    const extra = process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64;
    afterEachRestore.push(() => {
      restoreEnv("NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64", primary);
      restoreEnv("NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64", extra);
    });

    process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64 = "newKey";
    process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64 = " oldKey , newKey ,olderKey";
    // Primary comes first, whitespace is trimmed, and the duplicate of the primary is dropped so
    // rotation can add the previous key without listing the same pin twice.
    expect(gramWireIdentityPins()).toEqual(["newKey", "oldKey", "olderKey"]);

    process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64 = "solo";
    delete process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEYS_B64;
    expect(gramWireIdentityPins()).toEqual(["solo"]);

    delete process.env.NEXT_PUBLIC_GRAM_WIRE_IDENTITY_PUBLIC_KEY_B64;
    expect(gramWireIdentityPins()).toEqual([]);
  });
});

const afterEachRestore: Array<() => void> = [];

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  while (afterEachRestore.length) afterEachRestore.pop()?.();
});
