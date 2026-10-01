"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bold,
  Code,
  FileText,
  Italic,
  Link2,
  Mic,
  Paperclip,
  Send,
  Strikethrough,
  Underline,
  X
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useToast } from "../ui/toast";
import { EmojiPicker } from "./emoji-picker";

type Wrap = { key: string; label: string; icon: typeof Bold; before: string; after: string };

/**
 * Selecting text offers the same inline formatting the reference does. Markers go into the
 * message text itself, which is what the bubble reads back — no parallel rich-text document
 * to keep in step with the plain string the API stores.
 */
const WRAPS: Wrap[] = [
  { key: "bold", label: "Bold", icon: Bold, before: "**", after: "**" },
  { key: "italic", label: "Italic", icon: Italic, before: "*", after: "*" },
  { key: "underline", label: "Underlined", icon: Underline, before: "__", after: "__" },
  { key: "strike", label: "Strikethrough", icon: Strikethrough, before: "~~", after: "~~" },
  { key: "code", label: "Code", icon: Code, before: "`", after: "`" }
];

/** What the composer may carry alongside the text, and how to preview each kind. */
export type ComposerAttachment = {
  name: string;
  /** A local object URL, so a picture or a clip can be seen before it is sent. */
  preview: string;
  kind: "image" | "video" | "file";
};

/** What the file button offers: exactly the three sets the API is willing to store. */
const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/zip",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".log"
].join(",");

/** What the caption line calls the thing waiting to be sent. */
const KIND_LABEL: Record<ComposerAttachment["kind"], string> = {
  image: "Photo",
  video: "Video",
  file: "File"
};

/** What the chat screen may do to the field without owning its text. */
export type ComposerHandle = {
  clear: () => void;
  setText: (next: string) => void;
  focus: () => void;
};

/**
 * The composer owns its text.
 *
 * It used to be controlled from `ChatView`, so every keystroke re-rendered the whole screen —
 * the header, the menu and ten mounted sheets — which is what typing with a visible delay was.
 * The screen now hears about the text only when a message is actually sent, and reaches back in
 * through the handle for the two things it genuinely decides: prefilling an edit and clearing
 * after a successful send.
 */
export const MessageComposer = forwardRef<ComposerHandle, {
  onSubmit: (text: string) => void;
  /** A picked file is held by the caller until it is sent, so its caption can be typed first. */
  onPickFile: (file: File) => void;
  attachment: ComposerAttachment | null;
  onClearAttachment: () => void;
  editing: boolean;
  pending: boolean;
  /**
   * Whether file attachments are offered. Off for secret chats: file uploads go through the plain
   * media endpoint and are NOT end-to-end encrypted, so offering them in a secret chat would
   * silently leak the file to the server. Hidden until encrypted attachments exist.
   */
  allowAttachments?: boolean;
  /**
   * Called as the field is typed into, so the other side can be told.
   *
   * Passed in rather than sent from here because the socket belongs to the screen; the throttling
   * lives with the socket too, so this can fire on every keystroke without flooding anything.
   */
  onTyping?: () => void;
}>(function MessageComposer(
  { onSubmit: submit, onPickFile, attachment, onClearAttachment, editing, pending, allowAttachments = true, onTyping },
  handle
) {
  const [value, onChange] = useState("");
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const field = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  useImperativeHandle(
    handle,
    () => ({
      clear: () => onChange(""),
      setText: (next: string) => {
        onChange(next);
        requestAnimationFrame(() => field.current?.focus());
      },
      focus: () => field.current?.focus()
    }),
    []
  );
  // A picture is worth sending on its own, so it counts as content even with no caption.
  const filled = value.trim().length > 0 || Boolean(attachment);

  const readSelection = useCallback(() => {
    const node = field.current;
    if (!node) return;
    // Losing focus is what dismisses the toolbar; a selection left behind in a blurred field
    // would keep offering to format text the caret is no longer in.
    if (document.activeElement !== node) {
      setSelection(null);
      return;
    }
    const { selectionStart, selectionEnd } = node;
    setSelection(selectionEnd > selectionStart ? { start: selectionStart, end: selectionEnd } : null);
  }, []);

  /**
   * `selectionchange` on the document, not React's `onSelect`.
   *
   * React emulates `onSelect` from a handful of input events, so it misses selections made by
   * dragging out of the field, by keyboard after a paste, or programmatically. The document
   * event catches all of them.
   */
  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  /**
   * The field itself is the source of truth for the range, not the state mirror.
   *
   * Re-assigning a controlled textarea's value moves the caret, so a range captured on the
   * previous render can be stale by the time a second format is stacked on the first.
   */
  function currentRange() {
    const node = field.current;
    if (!node) return null;
    const start = node.selectionStart ?? selection?.start ?? 0;
    const end = node.selectionEnd ?? selection?.end ?? 0;
    if (end > start) return { start, end };
    return selection;
  }

  function apply(before: string, after: string) {
    const node = field.current;
    const range = currentRange();
    if (!node || !range) return;
    const { start, end } = range;
    const chosen = value.slice(start, end);
    onChange(`${value.slice(0, start)}${before}${chosen}${after}${value.slice(end)}`);
    // Keep the same words selected so a second format can be stacked on top.
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + before.length, end + before.length);
      setSelection({ start: start + before.length, end: end + before.length });
    });
  }

  function applyLink() {
    const node = field.current;
    const range = currentRange();
    if (!node || !range) return;
    const href = window.prompt("Link", "https://");
    if (!href?.trim()) return;
    const { start, end } = range;
    const label = value.slice(start, end);
    onChange(`${value.slice(0, start)}[${label}](${href.trim()})${value.slice(end)}`);
    setSelection(null);
    requestAnimationFrame(() => node.focus());
  }

  /**
   * Reads the field rather than the state mirror, which is what lets it be stable across
   * renders — and a stable handler is what keeps the memoised emoji panel out of every
   * keystroke's render.
   */
  const insert = useCallback((text: string) => {
    const node = field.current;
    if (!node) return;
    const current = node.value;
    const at = node.selectionStart ?? current.length;
    const end = node.selectionEnd ?? at;
    onChange(`${current.slice(0, at)}${text}${current.slice(end)}`);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(at + text.length, at + text.length);
    });
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (filled) submit(value);
      }}
      className="relative z-20 flex-none px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 sm:px-2.5 sm:pb-[max(env(safe-area-inset-bottom),10px)] sm:pt-2"
    >
      <AnimatePresence>
        {/* An empty field has nothing to format, so a range left over from the message just
            sent must not keep the toolbar on screen. */}
        {selection && filled ? (
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.98 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            role="toolbar"
            aria-label="Formatting"
            className="absolute -top-1 left-2.5 z-30 flex -translate-y-full items-center gap-0.5 rounded-[14px] border border-[var(--sheet-line)] p-1 shadow-[0_10px_30px_rgba(0,0,0,.5)]"
            style={{ background: "var(--menu)", backdropFilter: "var(--menu-blur)" }}
          >
            {WRAPS.map((wrap) => (
              <button
                key={wrap.key}
                type="button"
                aria-label={wrap.label}
                title={wrap.label}
                // Pointer-down, not click: a click would blur the field and drop the selection.
                onPointerDown={(event) => {
                  event.preventDefault();
                  apply(wrap.before, wrap.after);
                }}
                className="grid size-8 place-items-center rounded-[10px] text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--ink)]"
              >
                <wrap.icon size={16} />
              </button>
            ))}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--sheet-line)]" />
            <button
              type="button"
              aria-label="Link"
              title="Link"
              onPointerDown={(event) => {
                event.preventDefault();
                applyLink();
              }}
              className="grid size-8 place-items-center rounded-[10px] text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--ink)]"
            >
              <Link2 size={16} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {attachment ? (
        /* The picked file waits here while its caption is typed, so one send covers both. A clip
           previews as a muted frame and a document as its icon — an `<img>` pointed at a PDF drew
           a broken-image box, which is what the picker looked like before it accepted anything but
           pictures. */
        <div className="mb-2 flex items-center gap-2.5 rounded-[16px] border border-[var(--line)] bg-[var(--surface-raised)] p-2">
          {attachment.kind === "image" ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote asset */
            <img
              src={attachment.preview}
              alt=""
              className="size-12 flex-none rounded-[10px] object-cover"
            />
          ) : attachment.kind === "video" ? (
            <video
              src={attachment.preview}
              muted
              playsInline
              preload="metadata"
              tabIndex={-1}
              className="pointer-events-none size-12 flex-none rounded-[10px] object-cover"
            />
          ) : (
            <span className="grid size-12 flex-none place-items-center rounded-[10px] bg-white/[0.07] text-[var(--primary-strong)]">
              <FileText size={20} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{attachment.name}</span>
            <span className="block text-[12px] text-[var(--muted)]">
              {KIND_LABEL[attachment.kind]} · will be sent
            </span>
          </span>
          <button
            type="button"
            onClick={onClearAttachment}
            aria-label="Remove attachment"
            className="icon-button !size-11 flex-none"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="relative flex min-h-11 flex-1 items-end gap-0.5 rounded-[1.6rem] border border-[var(--line-strong)] bg-[var(--surface-2)] px-1.5 py-1 shadow-[0_1px_5px_-1px_rgba(0,0,0,.4)]">
          <div className="relative z-10 mb-px shrink-0">
            <EmojiPicker onPick={insert} />
          </div>
          <textarea
            ref={field}
            rows={1}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              // Only a field with something in it is "typing": clearing it is not an announcement.
              if (event.target.value.trim()) onTyping?.();
            }}
            onSelect={readSelection}
            onBlur={() => setSelection(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (filled) submit(value);
              }
            }}
            maxLength={2000}
            placeholder="Message"
            aria-label="Message"
            className="max-h-[140px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-5 outline-none placeholder:text-[var(--dim)]"
          />
          <input
            ref={picker}
            type="file"
            /* The API stores pictures, clips and documents on one endpoint, and this list is the
               set it is willing to accept. It used to allow images only, so a video or a PDF could
               not be sent from a chat at all — `ACCEPT` was declared above and never used. */
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clearing the input lets the same picture be picked twice in a row.
              event.target.value = "";
              if (file) onPickFile(file);
            }}
          />
          {/* No attachment button in a secret chat: files are not yet end-to-end encrypted, so
              offering one would quietly send the file to the server in the clear. */}
          {allowAttachments ? (
            <button
              type="button"
              className="mb-px inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--ink)]"
              aria-label="Attachment"
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={22} />
            </button>
          ) : null}
        </div>
        {/* One round action: the microphone until there is something to send. */}
        <button
          type={filled ? "submit" : "button"}
          disabled={pending}
          onClick={
            filled
              ? undefined
              : () =>
                  notify("Voice messages", {
                    variant: "info",
                    detail: "Coming in the next update"
                  })
          }
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
          style={{ background: "var(--chat-accent, var(--primary))" }}
          aria-label={
            filled
              ? editing
                ? "Save changes"
                : "Send"
              : "Voice message"
          }
        >
          {filled ? <Send size={20} /> : <Mic size={22} />}
        </button>
      </div>
    </form>
  );
});
