"use client";

import { AnimatePresence } from "framer-motion";
import { Fragment, memo } from "react";
import type { Message } from "@/lib/types";
import { MessageBubble } from "./message-bubble";

function startsNewDay(previous: Message | undefined, current: Message) {
  if (!previous) return true;
  return (
    new Date(previous.created_at).toDateString() !== new Date(current.created_at).toDateString()
  );
}

/** How long a pause breaks a run of messages from one person. */
const RUN_GAP_MS = 5 * 60 * 1000;

/**
 * Whether this bubble opens a run — the first thing one person says before somebody else speaks.
 *
 * Only the opener carries the author's name and picture; the rest of the run sits under it in a
 * held-open gutter. Naming every line would triple the height of a group thread and say nothing
 * new, and naming none of them is what made a group unreadable in the first place. A long pause
 * starts a fresh run even from the same person, because five minutes later it is a new remark.
 */
function opensRun(previous: Message | undefined, current: Message) {
  if (!previous || previous.service || previous.sender_id !== current.sender_id) return true;
  if (startsNewDay(previous, current)) return true;
  return (
    new Date(current.created_at).getTime() - new Date(previous.created_at).getTime() > RUN_GAP_MS
  );
}

/** Today and yesterday are named; anything older gets its date, as in the reference. */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = date.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" })
  }).format(date);
}

/**
 * The thread itself, kept apart from the screen around it.
 *
 * This is the optimisation that matters: the composer's text used to live in `ChatView`, so every
 * keystroke re-rendered a hundred bubbles — each with three mutations, a reaction hook and a
 * context menu behind it — which is what typing with a visible delay actually was. The list is
 * memoised and every handler it receives is stable, so a keystroke now re-renders the composer
 * and nothing else.
 */
function MessageThreadList({
  messages,
  chatId,
  group,
  selecting,
  picked,
  onReply,
  onEdit,
  onForward,
  onSelect,
  onReport,
  onToggleSelect
}: {
  messages: Message[];
  chatId: string;
  /** Only a group names its authors: in a direct chat there is exactly one other person. */
  group?: boolean;
  selecting: boolean;
  /** A set rather than an array: selection is checked once per row on every render. */
  picked: ReadonlySet<string>;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onSelect: (message: Message) => void;
  onReport: (message: Message) => void;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {messages.map((message, index) => {
        /* Named and pictured on the opening bubble of each run; the rest of the run keeps the
           gutter so the column of bubbles stays straight. */
        const attributed = Boolean(group) && !message.is_mine && !message.service;
        const opening = attributed && opensRun(messages[index - 1], message);
        return (
          /* Keyed by the client key when there is one: an optimistic bubble and the server's row
             that replaces it are the same bubble to the reader, and a changing key would unmount
             it mid-animation — the blink that made a sent message look re-sent. */
          <Fragment key={message.client_key ?? message.id}>
            {/* A separator opens each new day, the way the reference dates its thread. */}
            {startsNewDay(messages[index - 1], message) ? (
              <div className="flex justify-center py-2.5">
                <span className="chat-date-pill">{dayLabel(message.created_at)}</span>
              </div>
            ) : null}
            <MessageBubble
              message={message}
              chatId={chatId}
              onReply={onReply}
              onEdit={onEdit}
              onForward={onForward}
              onSelect={onSelect}
              onReport={onReport}
              selectable={selecting && !message.service && !message.pending}
              selected={picked.has(message.id)}
              onToggleSelect={onToggleSelect}
              showSender={opening}
              showAvatar={opening}
              showGutter={attributed}
            />
          </Fragment>
        );
      })}
    </AnimatePresence>
  );
}

export const MessageThread = memo(MessageThreadList);
