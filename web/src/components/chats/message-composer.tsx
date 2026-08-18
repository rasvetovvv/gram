"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bold,
  Code,
  Italic,
  Link2,
  Mic,
  Paperclip,
  Send,
  Strikethrough,
  Underline,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../ui/toast";
import { EmojiPicker } from "./emoji-picker";

type Wrap = { key: string; label: string; icon: typeof Bold; before: string; after: string };

/**
 * Selecting text offers the same inline formatting the reference does. Markers go into the
 * message text itself, which is what the bubble reads back — no parallel rich-text document
 * to keep in step with the plain string the API stores.
 */
const WRAPS: Wrap[] = [
  { key: "bold", label: "Жирный", icon: Bold, before: "**", after: "**" },
  { key: "italic", label: "Курсив", icon: Italic, before: "*", after: "*" },
  { key: "underline", label: "Подчёркнутый", icon: Underline, before: "__", after: "__" },
  { key: "strike", label: "Зачёркнутый", icon: Strikethrough, before: "~~", after: "~~" },
  { key: "code", label: "Код", icon: Code, before: "`", after: "`" }
];

export function MessageComposer({
  value,
  onChange,
  onSubmit,
  onPickFile,
  attachment,
  onClearAttachment,
  editing,
  pending
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** A picked image is held by the caller until it is sent, so its caption can be typed first. */
  onPickFile: (file: File) => void;
  attachment: { name: string; preview: string } | null;
  onClearAttachment: () => void;
  editing: boolean;
  pending: boolean;
}) {
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const field = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
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
    const href = window.prompt("Ссылка", "https://");
    if (!href?.trim()) return;
    const { start, end } = range;
    const label = value.slice(start, end);
    onChange(`${value.slice(0, start)}[${label}](${href.trim()})${value.slice(end)}`);
    setSelection(null);
    requestAnimationFrame(() => node.focus());
  }

  function insert(text: string) {
    const node = field.current;
    const at = node?.selectionStart ?? value.length;
    onChange(`${value.slice(0, at)}${text}${value.slice(node?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (filled) onSubmit();
      }}
      className="relative z-20 flex-none px-2.5 pb-[max(env(safe-area-inset-bottom),10px)] pt-2"
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
            aria-label="Форматирование"
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
              aria-label="Ссылка"
              title="Ссылка"
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
        /* The picked picture waits here while its caption is typed, so one send covers both. */
        <div className="mb-2 flex items-center gap-2.5 rounded-[16px] border border-[var(--line)] bg-[var(--surface-raised)] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote asset */}
          <img
            src={attachment.preview}
            alt=""
            className="size-12 flex-none rounded-[10px] object-cover"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{attachment.name}</span>
            <span className="block text-[12px] text-[var(--muted)]">Фото · будет отправлено</span>
          </span>
          <button
            type="button"
            onClick={onClearAttachment}
            aria-label="Убрать вложение"
            className="icon-button !size-8 flex-none"
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
            onChange={(event) => onChange(event.target.value)}
            onSelect={readSelection}
            onBlur={() => setSelection(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (filled) onSubmit();
              }
            }}
            maxLength={2000}
            placeholder="Сообщение"
            aria-label="Сообщение"
            className="max-h-[140px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-5 outline-none placeholder:text-[var(--dim)]"
          />
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clearing the input lets the same picture be picked twice in a row.
              event.target.value = "";
              if (file) onPickFile(file);
            }}
          />
          <button
            type="button"
            className="mb-px inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--ink)]"
            aria-label="Вложение"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={22} />
          </button>
        </div>
        {/* One round action: the microphone until there is something to send. */}
        <button
          type={filled ? "submit" : "button"}
          disabled={pending}
          onClick={
            filled
              ? undefined
              : () =>
                  notify("Голосовые сообщения", {
                    variant: "info",
                    detail: "Появятся в следующем обновлении"
                  })
          }
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
          style={{ background: "var(--chat-accent, var(--primary))" }}
          aria-label={
            filled
              ? editing
                ? "Сохранить изменение"
                : "Отправить"
              : "Голосовое сообщение"
          }
        >
          {filled ? <Send size={20} /> : <Mic size={22} />}
        </button>
      </div>
    </form>
  );
}
