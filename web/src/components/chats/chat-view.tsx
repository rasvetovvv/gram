"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  Copy,
  CornerUpRight,
  Pencil,
  Pin,
  Reply,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Chat, Message } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { presenceShort } from "@/lib/presence";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { AdminMark } from "../admin-mark";
import { VerifiedMark } from "../verified-mark";
import { useToast } from "../ui/toast";
import { ChatAppearanceSheet, ChatWallpaperSheet } from "./chat-appearance-sheet";
import { ChatGiftSheet } from "./chat-gift-sheet";
import { ChatInfoPanel } from "./chat-info-panel";
import { ChatList } from "./chat-list";
import { ChatMenu } from "./chat-menu";
import { ForwardPicker } from "./forward-picker";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { useChatSocket } from "./use-chat-socket";

export function ChatView() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { data: chats = [], isLoading } = useQuery({
    queryKey: ["chats"],
    queryFn: api.chats,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
  const requested = params.get("chat") ?? undefined;
  /**
   * A chat opened from somewhere else — a profile, a notification, a shared link — is usually
   * not in the cached list yet. Requiring it to be there dropped the caller back onto the
   * list, so a missing chat is fetched on its own instead.
   */
  const listed = chats.find((chat) => chat.id === requested);
  const fallback = useQuery({
    queryKey: ["chat-info", requested],
    queryFn: () => api.chatInfo(requested!),
    enabled: Boolean(requested) && !listed
  });
  const activeChat: Chat | undefined = listed ?? fallback.data?.chat;
  const activeId = activeChat?.id;

  useEffect(() => {
    // An id that resolves to nothing is a dead link; return to the list rather than hang.
    if (requested && fallback.isError) router.replace("/chats");
  }, [requested, fallback.isError, router]);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", activeId],
    queryFn: () => api.messages(activeId!),
    enabled: Boolean(activeId),
    // The socket carries new messages; the poll is only the net under a dropped connection.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false
  });
  useChatSocket(activeId);

  // Fetching the window is what clears the badge on the server, so the list is refreshed as
  // soon as that has happened instead of waiting out its own interval.
  const seenCount = useRef(0);
  useEffect(() => {
    if (!activeId || !messages.length || seenCount.current === messages.length) return;
    seenCount.current = messages.length;
    queryClient.invalidateQueries({ queryKey: ["chats"] });
  }, [activeId, messages.length, queryClient]);

  const [draft, setDraft] = useState("");
  /**
   * One composer serves three jobs: new message, reply, and editing an existing one.
   *
   * The context carries its chat id so switching conversations discards it by derivation —
   * a reply or edit must never be applied to a different chat's message.
   */
  const [draftContext, setDraftContext] = useState<{
    chatId?: string;
    reply: Message | null;
    edit: Message | null;
  }>({ reply: null, edit: null });
  const context = draftContext.chatId === activeId ? draftContext : { reply: null, edit: null };
  const replyTo = context.reply;
  const editing = context.edit;

  function setReplyTo(message: Message | null) {
    setDraftContext({ chatId: activeId, reply: message, edit: null });
  }

  function beginEdit(message: Message) {
    setDraftContext({ chatId: activeId, reply: null, edit: message });
    setDraft(message.content);
  }

  function cancelDraftContext() {
    setDraftContext({ chatId: activeId, reply: null, edit: null });
    setDraft("");
  }

  /**
   * A picked image waits with its own chat id, so switching conversations discards it by
   * derivation rather than by an effect — the same trick the draft context uses.
   */
  const [pendingFile, setPendingFile] = useState<{
    chatId?: string;
    file: File;
    preview: string;
  } | null>(null);
  const attachment = pendingFile?.chatId === activeId ? pendingFile : null;

  function clearAttachment() {
    if (pendingFile) URL.revokeObjectURL(pendingFile.preview);
    setPendingFile(null);
  }

  const send = useMutation({
    mutationFn: () =>
      editing
        ? api.editMessage(activeId!, editing.id, draft.trim())
        : attachment
          ? api.sendMessageMedia(activeId!, attachment.file, draft.trim(), replyTo?.id)
          : api.sendMessage(activeId!, draft.trim(), replyTo?.id),
    onSuccess: async () => {
      const wasEditing = Boolean(editing);
      cancelDraftContext();
      clearAttachment();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", activeId] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] })
      ]);
      if (wasEditing) notify("Сообщение изменено", { variant: "success" });
    },
    onError: (error: Error) =>
      notify(editing ? "Не удалось изменить" : "Сообщение не отправлено", {
        variant: "error",
        detail: error.message
      })
  });

  const [giftOpen, setGiftOpen] = useState(false);
  /**
   * The info panel, the in-chat search, the appearance sheets and message selection all belong
   * to one conversation, so they carry its id and are derived away on switch — the same trick
   * the draft context uses above.
   */
  const [chatUi, setChatUi] = useState<{
    chatId?: string;
    info: boolean;
    searchOpen: boolean;
    search: string;
    appearance: boolean;
    wallpaper: boolean;
    selecting: boolean;
    picked: string[];
    forwarding: boolean;
  }>({
    info: false,
    searchOpen: false,
    search: "",
    appearance: false,
    wallpaper: false,
    selecting: false,
    picked: [],
    forwarding: false
  });
  const ui =
    chatUi.chatId === activeId
      ? chatUi
      : {
          info: false,
          searchOpen: false,
          search: "",
          appearance: false,
          wallpaper: false,
          selecting: false,
          picked: [] as string[],
          forwarding: false
        };
  /**
   * Patches merge into the *previous* state, not into the value this render closed over: two
   * calls in one tick (a forward finishing, then its sheet closing) would otherwise clobber
   * each other and leave selection mode on.
   */
  const setUi = (patch: Partial<typeof chatUi>) =>
    setChatUi((current) => ({
      ...(current.chatId === activeId ? current : ui),
      chatId: activeId,
      ...patch
    }));

  function togglePicked(id: string) {
    setUi({
      picked: ui.picked.includes(id) ? ui.picked.filter((item) => item !== id) : [...ui.picked, id]
    });
  }

  const clearChat = useMutation({
    mutationFn: () => api.deleteChat(activeId!),
    onSuccess: async () => {
      setUi({ selecting: false, picked: [] });
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      await queryClient.invalidateQueries({ queryKey: ["messages", activeId] });
      notify("Чат очищен", { variant: "success", detail: "У собеседника история осталась" });
    },
    onError: (error: Error) =>
      notify("Не удалось очистить", { variant: "error", detail: error.message })
  });

  const deletePicked = useMutation({
    mutationFn: async () => {
      // "For everyone" is the author's right alone, so each message takes the widest scope
      // its own author allows and the rest are hidden for me.
      for (const id of ui.picked) {
        const message = messages.find((item) => item.id === id);
        await api.deleteMessage(activeId!, id, message?.is_mine ? "all" : "me");
      }
    },
    onSuccess: async () => {
      const count = ui.picked.length;
      setUi({ selecting: false, picked: [] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", activeId] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] })
      ]);
      notify(count === 1 ? "Сообщение удалено" : `Удалено: ${count}`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить", { variant: "error", detail: error.message })
  });

  async function copyPicked() {
    const text = messages
      .filter((item) => ui.picked.includes(item.id))
      .map((item) => item.content)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setUi({ selecting: false, picked: [] });
      notify("Скопировано", { variant: "success" });
    } catch {
      notify("Не удалось скопировать", {
        variant: "error",
        detail: "Браузер не дал доступ к буферу обмена"
      });
    }
  }

  // Search narrows what is already loaded; the API has no message search yet.
  const grouped = useMemo(() => {
    const needle = ui.search.trim().toLowerCase();
    return needle ? messages.filter((item) => item.content.toLowerCase().includes(needle)) : messages;
  }, [messages, ui.search]);
  // Only one message is pinned per chat, so the bar takes the first it finds.
  const pinnedMessage = useMemo(() => messages.find((item) => item.pinned), [messages]);

  /**
   * Scroll position drives both the jump button and its count of messages missed while away.
   *
   * Like the draft context above, it hangs off the chat id and is derived back to defaults on
   * switch, so no effect has to reset it.
   */
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<{
    chatId?: string;
    atBottom: boolean;
    unseen: number;
  }>({ atBottom: true, unseen: 0 });
  const { atBottom, unseen } =
    scrollState.chatId === activeId ? scrollState : { atBottom: true, unseen: 0 };
  const lastCount = useRef<{ chatId?: string; count: number }>({ count: 0 });

  // Both callbacks stamp the chat they belong to, or a scroll in a new conversation would be
  // filed against the previous one and derived away.
  const jumpToBottom = useCallback(
    (smooth = true) => {
      const node = scroller.current;
      if (!node) return;
      // Two frames: one for React to commit the new bubble, one for layout to measure it.
      // A single frame reads a stale scrollHeight and stops short of the newest message.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" })
        )
      );
      setScrollState({ chatId: activeId, atBottom: true, unseen: 0 });
    },
    [activeId]
  );

  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    setScrollState((current) => ({
      chatId: activeId,
      atBottom: bottom,
      unseen: bottom || current.chatId !== activeId ? 0 : current.unseen
    }));
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    // A new conversation starts from its newest message, with nothing yet missed.
    const switched = lastCount.current.chatId !== activeId;
    const previous = switched ? 0 : lastCount.current.count;
    lastCount.current = { chatId: activeId, count: messages.length };
    const grew = messages.length - previous;
    if (grew <= 0) return;
    const mine = messages[messages.length - 1]?.is_mine;
    // Reading further up should not be yanked away; my own message always follows me down.
    if (switched || atBottom || mine) {
      jumpToBottom(!switched);
      return;
    }
    setScrollState((current) => ({
      chatId: activeId,
      atBottom: false,
      unseen: (current.chatId === activeId ? current.unseen : 0) + grew
    }));
  }, [activeId, messages, atBottom, jumpToBottom]);

  const subtitle = !activeChat
    ? ""
    : activeChat.is_group
      ? `${activeChat.members_count ?? 0} участника`
      : activeChat.kind === "saved"
        ? "только для вас"
        : // A closed conversation is the first thing worth knowing about it.
          activeChat.peer_blocked
          ? "заблокирован"
          : activeChat.blocked_by_peer
            ? "вы заблокированы"
            : activeChat.is_typing
              ? "печатает…"
              : activeChat.participant?.is_official
                ? (activeChat.participant.role_title ?? "служебные уведомления").toLowerCase()
                : // Presence, worded once in `lib/presence` and reused by the profile.
                  presenceShort(activeChat.participant ?? { is_online: false }) ||
                  `@${activeChat.participant?.username ?? ""}`;

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden" data-active-chat={Boolean(activeChat)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <section className={`${activeChat ? "hidden" : "flex"} min-h-0 flex-1 flex-col overflow-y-auto`}>
          <ChatList chats={chats} isLoading={isLoading} activeId={activeId} />
        </section>

        {activeChat ? (
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Wallpaper sits behind the whole conversation, as in the reference. */}
            <div className="chat-wallpaper" aria-hidden />

            <header className="relative z-30 flex-none px-2.5 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
              {ui.selecting ? (
                /* Selection replaces the header, as in the reference: clear on one side,
                   the running count in the middle, and a way out on the other. */
                <div className="chat-topbar">
                  <button
                    type="button"
                    onClick={() => clearChat.mutate()}
                    disabled={clearChat.isPending}
                    className="h-9 flex-none rounded-full px-3 text-[15px] text-[var(--danger)] transition active:bg-white/10 disabled:opacity-50"
                  >
                    Очистить чат
                  </button>
                  <span className="min-w-0 flex-1 text-center text-[15px] font-semibold">
                    {ui.picked.length} выбрано
                  </span>
                  <button
                    type="button"
                    onClick={() => setUi({ selecting: false, picked: [] })}
                    className="h-9 flex-none rounded-full px-3 text-[15px] transition active:bg-white/10"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
              <div className="chat-topbar">
                <button className="icon-button !size-10" onClick={() => router.push("/chats")} aria-label="К списку чатов"><ArrowLeft size={22} /></button>
                {/* The whole title block is the way into the info panel, as in the reference. */}
                <button
                  type="button"
                  onClick={() => setUi({ info: true })}
                  aria-label={activeChat.is_group ? "О группе" : "О чате"}
                  className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 pr-1 text-left transition active:opacity-70"
                >
                  {activeChat.is_group || !activeChat.participant ? (
                    <UserAvatar
                      src={activeChat.avatar_url}
                      name={activeChat.title ?? "Чат"}
                      size={42}
                      radius={activeChat.kind === "saved" ? "50%" : "12px"}
                    />
                  ) : (
                    <UserAvatar
                      src={activeChat.participant.avatar_url}
                      name={activeChat.participant.display_name}
                      online={activeChat.participant.is_online}
                      size={42}
                    />
                  )}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-1.5 text-[15px] font-bold">
                      <span
                        className="truncate"
                        style={{
                          color: activeChat.is_group
                            ? "var(--ink)"
                            : nameColor(activeChat.participant?.profile_color)
                        }}
                      >
                        {activeChat.title ?? activeChat.participant?.display_name}
                      </span>
                      {/* A group's title carries no member's marks. */}
                      {!activeChat.is_group && activeChat.participant?.verified ? <VerifiedMark size={16} /> : null}
                      {!activeChat.is_group && activeChat.participant?.is_admin ? <AdminMark size={15} /> : null}
                      {!activeChat.is_group && activeChat.participant?.is_premium ? (
                        <PremiumMark size={15} profileColor={activeChat.participant.profile_color} />
                      ) : null}
                    </span>
                    <span className="block truncate text-[13px] text-[var(--muted)]">{subtitle}</span>
                  </span>
                </button>
                <button className="icon-button !size-10" aria-label="Поиск по чату" onClick={() => setUi({ searchOpen: !ui.searchOpen })}><Search size={20} /></button>
                <ChatMenu
                  chat={activeChat}
                  onSearch={() => setUi({ searchOpen: true })}
                  onSendGift={() => setGiftOpen(true)}
                  onSelectMessages={() => setUi({ selecting: true, picked: [] })}
                  onOpenInfo={() => setUi({ info: true })}
                  onAppearance={() => setUi({ appearance: true })}
                  onWallpaper={() => setUi({ wallpaper: true })}
                />
              </div>
              )}
            </header>

            {ui.searchOpen ? (
              <div className="relative z-30 mx-2.5 mb-2 flex flex-none items-center gap-2 rounded-[20px] bg-[var(--surface-raised)] px-3 py-2 shadow-[0_1px_5px_-1px_rgba(0,0,0,.21)]">
                <Search size={16} className="flex-none text-[var(--muted)]" />
                <input
                  autoFocus
                  value={ui.search}
                  onChange={(event) => setUi({ search: event.target.value })}
                  placeholder="Поиск по сообщениям"
                  aria-label="Поиск по сообщениям"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--dim)]"
                />
                <span className="flex-none text-xs text-[var(--dim)]">
                  {ui.search.trim() ? `${grouped.length} найдено` : null}
                </span>
                <button
                  type="button"
                  className="icon-button !size-8"
                  aria-label="Закрыть поиск"
                  onClick={() => {
                    setUi({ searchOpen: false, search: "" });
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ) : null}

            {pinnedMessage ? (
              <PinnedBar
                message={pinnedMessage}
                chatId={activeChat.id}
                onJump={() =>
                  document
                    .getElementById(`message-${pinnedMessage.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              />
            ) : null}

            <div
              ref={scroller}
              onScroll={onScroll}
              className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-2.5 pb-2"
            >
              <div className="mx-auto flex min-h-full max-w-[600px] flex-col gap-1">
                {/* An auto margin rather than `justify-end`: with justify-end a thread taller
                    than the viewport is clipped at the top and cannot be scrolled back to. */}
                <div aria-hidden className="mt-auto" />
                <AnimatePresence initial={false} mode="popLayout">
                  {grouped.map((message, index) => (
                    <Fragment key={message.id}>
                      {/* A separator opens each new day, the way the reference dates its thread. */}
                      {startsNewDay(grouped[index - 1], message) ? (
                        <div className="flex justify-center py-2.5">
                          <span className="chat-date-pill">{dayLabel(message.created_at)}</span>
                        </div>
                      ) : null}
                      <MessageBubble
                        message={message}
                        chatId={activeChat.id}
                        onReply={setReplyTo}
                        onEdit={beginEdit}
                        onForward={(item) =>
                          setUi({ selecting: true, picked: [item.id], forwarding: true })
                        }
                        onSelect={(item) => setUi({ selecting: true, picked: [item.id] })}
                        selectable={ui.selecting && !message.service}
                        selected={ui.picked.includes(message.id)}
                        onToggleSelect={() => togglePicked(message.id)}
                      />
                    </Fragment>
                  ))}
                </AnimatePresence>
                <div data-message-end />
              </div>
            </div>

            <JumpToBottom show={!atBottom} unseen={unseen} onJump={() => jumpToBottom()} />

            {replyTo || editing ? (
              <div className="flex flex-none items-center gap-2 border-t border-[#27272a] bg-[#0a0e11] px-3 pt-2 text-xs">
                <span className="grid size-7 flex-none place-items-center rounded-full bg-[var(--surface-raised)] text-[var(--muted)]">
                  {editing ? <Pencil size={14} /> : <Reply size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[0.72rem] uppercase tracking-[.06em] text-[var(--faint)]">
                    {editing ? "Изменение сообщения" : `Ответ ${replyTo?.is_mine ? "себе" : (activeChat.participant?.display_name ?? "в группу")}`}
                  </strong>
                  <span className="block truncate text-[var(--muted)]">{(editing ?? replyTo)?.content}</span>
                </span>
                <button type="button" className="icon-button !size-7" aria-label="Отменить" onClick={cancelDraftContext}>
                  <X size={15} />
                </button>
              </div>
            ) : null}

            {ui.selecting ? (
              /* The reference's own three actions, pinned where the composer was. `z-20`
                 matches the composer: the wallpaper is absolutely positioned, so a static
                 bar would be painted underneath it. */
              <div className="relative z-20 flex flex-none items-center justify-around gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
                <SelectionAction
                  icon={Trash2}
                  label="Удалить"
                  danger
                  disabled={!ui.picked.length || deletePicked.isPending}
                  onClick={() => deletePicked.mutate()}
                />
                <SelectionAction
                  icon={Copy}
                  label="Копировать"
                  disabled={!ui.picked.length}
                  onClick={copyPicked}
                />
                <SelectionAction
                  icon={CornerUpRight}
                  label="Переслать"
                  disabled={!ui.picked.length}
                  onClick={() => setUi({ forwarding: true })}
                />
              </div>
            ) : activeChat.peer_blocked || activeChat.blocked_by_peer ? (
              <BlockedBar chat={activeChat} />
            ) : (
              <MessageComposer
                value={draft}
                onChange={setDraft}
                onSubmit={() => {
                  if (draft.trim() || attachment) send.mutate();
                }}
                onPickFile={(file) => {
                  clearAttachment();
                  setPendingFile({
                    chatId: activeId,
                    file,
                    preview: URL.createObjectURL(file)
                  });
                }}
                attachment={attachment ? { name: attachment.file.name, preview: attachment.preview } : null}
                onClearAttachment={clearAttachment}
                editing={Boolean(editing)}
                pending={send.isPending}
              />
            )}
            <ChatGiftSheet chat={activeChat} open={giftOpen} onOpenChange={setGiftOpen} />
            <ChatInfoPanel
              chat={activeChat}
              open={ui.info}
              onClose={() => setUi({ info: false })}
              onSendGift={() => setGiftOpen(true)}
            />
            <ChatAppearanceSheet
              open={ui.appearance}
              onOpenChange={(open) => setUi({ appearance: open })}
            />
            <ChatWallpaperSheet
              open={ui.wallpaper}
              onOpenChange={(open) => setUi({ wallpaper: open })}
            />
            <ForwardPicker
              open={ui.forwarding}
              onClose={() => setUi({ forwarding: false })}
              fromChatId={activeChat.id}
              messageIds={ui.picked}
              onDone={() => setUi({ selecting: false, picked: [], forwarding: false })}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}


/**
 * What stands where the composer would be in a closed conversation.
 *
 * My own block is undoable right here, which is where anyone would look for it. Their block is
 * not mine to lift, so the bar says plainly why there is nothing to type into — the send would
 * be refused anyway, and a dead field explains nothing.
 */
function BlockedBar({ chat }: { chat: Chat }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const peer = chat.participant?.username;
  const unblock = useMutation({
    mutationFn: () => api.unblockUser(peer!),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-info", chat.id] }),
        queryClient.invalidateQueries({ queryKey: ["profile", peer] })
      ]);
      notify(result.detail, { variant: "success", detail: "Переписка снова открыта" });
    },
    onError: (error: Error) =>
      notify("Не удалось разблокировать", { variant: "error", detail: error.message })
  });

  return (
    <div className="relative z-20 flex-none border-t border-[var(--line)] bg-[var(--surface)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      {chat.peer_blocked ? (
        <>
          <p className="m-0 mb-2 flex items-center justify-center gap-1.5 text-[13px] text-[var(--muted)]">
            <Ban size={14} className="text-[var(--danger)]" />
            Вы заблокировали {chat.participant?.display_name ?? "этого пользователя"}
          </p>
          <button
            type="button"
            onClick={() => unblock.mutate()}
            disabled={unblock.isPending || !peer}
            className="min-h-11 w-full rounded-[14px] text-[15px] font-bold text-[var(--danger)] transition active:scale-[0.99] disabled:opacity-50"
            style={{ background: "rgba(239,68,68,.14)" }}
          >
            {unblock.isPending ? "Разблокируем…" : "Разблокировать"}
          </button>
        </>
      ) : (
        <p className="m-0 flex min-h-11 items-center justify-center gap-1.5 text-center text-[13px] text-[var(--muted)]">
          <Ban size={14} className="flex-none" />
          Вы не можете писать этому пользователю
        </p>
      )}
    </div>
  );
}

/**
 * One action in the selection bar: a glyph over its name, disabled until something is picked.
 */
function SelectionAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger = false
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[14px] text-[12px] transition active:bg-white/[0.06] disabled:opacity-40 ${
        danger ? "text-[var(--danger)]" : "text-[var(--ink)]"
      }`}
    >
      <Icon size={20} />
      {label}
    </button>
  );
}

/**
 * The reference's jump button: a round action above the composer carrying the number of
 * messages that arrived while the reader was further up the thread.
 */
function JumpToBottom({
  show,
  unseen,
  onJump
}: {
  show: boolean;
  unseen: number;
  onJump: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {show ? (
        <motion.button
          type="button"
          onClick={onJump}
          initial={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.9 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.9 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          aria-label={unseen ? `Вниз, ${unseen} новых` : "Вниз"}
          className="absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-30 grid size-11 place-items-center rounded-full bg-[var(--surface-raised)] text-[var(--ink)] shadow-[0_6px_20px_rgba(0,0,0,.45)]"
        >
          <ArrowDown size={20} />
          {unseen ? (
            <span
              className="absolute -top-1 right-0 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
              style={{ background: "var(--primary)" }}
            >
              {unseen > 99 ? "99+" : unseen}
            </span>
          ) : null}
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Pinned message bar under the topbar, matching the reference: pin glyph, accent strip,
 * accent title, one-line preview, and a round unpin button. The bar itself jumps to the
 * message, which is the only way to reach a pin far up the thread.
 */
function PinnedBar({
  message,
  chatId,
  onJump
}: {
  message: Message;
  chatId: string;
  onJump: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const unpin = useMutation({
    mutationFn: () => api.pinMessage(chatId, message.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      notify("Сообщение откреплено", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось открепить", { variant: "error", detail: error.message })
  });
  return (
    <div className="chat-pinned-bar">
      <Pin size={18} className="flex-none text-[var(--muted)]" />
      <span aria-hidden className="chat-pinned-strip" />
      <button
        type="button"
        onClick={onJump}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
      >
        <span className="block text-[14px] leading-tight text-[var(--primary-strong)]">
          Закреплённое сообщение
        </span>
        <span className="block truncate text-[14px] leading-tight text-[var(--muted)]">
          {message.content}
        </span>
      </button>
      <button
        type="button"
        onClick={() => unpin.mutate()}
        disabled={unpin.isPending}
        className="icon-button !size-8 flex-none"
        aria-label="Открепить"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function startsNewDay(previous: Message | undefined, current: Message) {
  if (!previous) return true;
  return new Date(previous.created_at).toDateString() !== new Date(current.created_at).toDateString();
}

/** Today and yesterday are named; anything older gets its date, as in the reference. */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  const sameYear = date.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" })
  }).format(date);
}
