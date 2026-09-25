"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Chat } from "@/lib/types";
import { UserAvatar } from "../user-avatar";
import { useToast } from "../ui/toast";

/** Selection accent, the same sky the chat pickers use for "chosen for this list". */
const PICK_ACCENT = "#0ea5e9";

/**
 * Where to send a story — mine or somebody else's.
 *
 * Conversations rather than people, because a story goes into a group as readily as into a
 * direct chat, and the chat list is the list the reader already knows. A line of one's own is
 * optional: sharing something silently is the common case.
 */
export function StoryShareSheet({
  open,
  onClose,
  storyId,
  storyTitle,
  authorName
}: {
  open: boolean;
  onClose: () => void;
  storyId: string;
  storyTitle: string;
  authorName: string;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <ShareBody
          onClose={onClose}
          storyId={storyId}
          storyTitle={storyTitle}
          authorName={authorName}
        />
      ) : null}
    </AnimatePresence>
  );
}

function ShareBody({
  onClose,
  storyId,
  storyTitle,
  authorName
}: {
  onClose: () => void;
  storyId: string;
  storyTitle: string;
  authorName: string;
}) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: chats = [] } = useQuery({ queryKey: ["chats"], queryFn: api.chats });
  const needle = query.trim().toLowerCase();
  const options = useMemo(
    () =>
      chats.filter(
        (chat) =>
          !needle ||
          (chat.title ?? chat.participant?.display_name ?? "").toLowerCase().includes(needle) ||
          (chat.participant?.username ?? "").toLowerCase().includes(needle)
      ),
    [chats, needle]
  );

  const share = useMutation({
    mutationFn: () => api.shareStory(storyId, picked, note.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
        ...picked.map((id) => queryClient.invalidateQueries({ queryKey: ["messages", id] }))
      ]);
      notify(picked.length > 1 ? `Story sent to ${picked.length} chats` : "Story sent", {
        variant: "success",
        detail: storyTitle || `${authorName}'s story`
      });
      onClose();
    },
    onError: (error: Error) =>
      notify("Couldn't send the story", { variant: "error", detail: error.message })
  });

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Share story"
      initial={reduceMotion ? undefined : { opacity: 0, y: 24 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 24 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      // Above the story viewer, which is itself a full-screen layer.
      className="fixed inset-0 z-[130] flex flex-col bg-[var(--sheet)] text-[var(--ink)]"
    >
      <div className="flex flex-none items-center gap-2 border-b border-[var(--sheet-line)] px-2 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="m-0 flex-1 truncate text-[18px] font-medium">
          Send story
          <span className="ml-2 text-[13px] text-[var(--muted)]">{authorName}</span>
        </h2>
        <button
          type="button"
          disabled={!picked.length || share.isPending}
          onClick={() => share.mutate()}
          className="h-9 rounded-full px-4 text-[15px] font-medium transition disabled:opacity-50"
          style={picked.length ? { background: PICK_ACCENT, color: "#fff" } : { color: "var(--muted)" }}
        >
          {share.isPending ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="flex-none space-y-2 px-3 py-2">
        <div className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] px-4">
          <Search size={20} className="flex-none text-[var(--muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Where to send"
            aria-label="Where to send"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted)]"
          />
        </div>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          placeholder="Add a message — optional"
          aria-label="Message with the story"
          className="h-10 w-full rounded-full bg-white/[0.06] px-4 text-[15px] outline-none placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {options.length ? null : (
          <p className="m-0 px-3 py-4 text-center text-[13px] text-[var(--muted)]">
            {needle ? "Nothing found" : "No chats yet"}
          </p>
        )}
        {options.map((chat) => {
          const chosen = picked.includes(chat.id);
          return (
            <button
              key={chat.id}
              type="button"
              aria-pressed={chosen}
              onClick={() =>
                setPicked((current) =>
                  current.includes(chat.id)
                    ? current.filter((id) => id !== chat.id)
                    : [...current, chat.id]
                )
              }
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition active:bg-white/[0.04]"
            >
              <ChatFace chat={chat} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">
                  {chat.title ?? chat.participant?.display_name}
                </span>
                <span className="block truncate text-[13px] text-[var(--muted)]">
                  {chat.is_group
                    ? `${chat.members_count ?? 0} members`
                    : `@${chat.participant?.username ?? ""}`}
                </span>
              </span>
              <span
                aria-hidden
                className="inline-flex size-6 flex-none items-center justify-center rounded-full border transition"
                style={
                  chosen
                    ? { borderColor: PICK_ACCENT, background: PICK_ACCENT, color: "#fff" }
                    : { borderColor: "rgba(255,255,255,.2)" }
                }
              >
                {chosen ? <Check size={16} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function ChatFace({ chat }: { chat: Chat }) {
  if (chat.is_group || !chat.participant) {
    return (
      <UserAvatar
        src={chat.avatar_url}
        name={chat.title ?? "Chat"}
        size={44}
        radius={chat.kind === "saved" ? "50%" : "12px"}
      />
    );
  }
  return (
    <UserAvatar
      src={chat.participant.avatar_url}
      name={chat.participant.display_name}
      online={chat.participant.is_online}
      size={44}
    />
  );
}
