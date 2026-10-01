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
import { plural } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { AdminMark } from "../admin-mark";
import { VerifiedMark } from "../verified-mark";
import { useToast } from "../ui/toast";
import { useSocialEvents, type SocialEvent } from "../use-social-socket";
import { ChatAppearanceSheet, ChatWallpaperSheet } from "./chat-appearance-sheet";
import { ChatReportSheet } from "./report-sheets";
import { ChatGiftSheet } from "./chat-gift-sheet";
import { ChatInfoPanel } from "./chat-info-panel";
import { ChatList } from "./chat-list";
import { ChatMenu } from "./chat-menu";
import { ForwardPicker } from "./forward-picker";
import { MessageThread } from "./message-thread";
import { MessageComposer, type ComposerHandle } from "./message-composer";
import { useChatSocket, mergeMessage } from "./use-chat-socket";
import { useSecretChat } from "./use-secret-chat";
import { useSecretGroup } from "./use-secret-group";
import { SafetyNumberSheet } from "./safety-number-sheet";
import { useVisualViewportHeight } from "./use-visual-viewport";

export function ChatView() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  /**
   * Keeps the conversation's height in step with the keyboard on iOS, and follows the thread down
   * when it opens.
   *
   * The callback is indirected through a ref because `jumpToBottom` is defined further down, after
   * the state it closes over — and a keyboard appearing while you are reading the newest message
   * must not leave that message hidden behind it.
   */
  const onViewportResize = useRef<(() => void) | null>(null);
  useVisualViewportHeight(useCallback(() => onViewportResize.current?.(), []));
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
    refetchInterval: 45_000,
    refetchIntervalInBackground: false
  });
  const { typing, notifyTyping, markRead } = useChatSocket(activeId);
  // Needed to author an optimistic bubble before the server has answered.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  // Secret chats: decrypt inbound bodies for display and encrypt outbound before send. For any
  // other chat this is a transparent pass-through (isSecret === false).
  const secret1to1 = useSecretChat(activeChat, me?.id, messages);
  const secretGroup = useSecretGroup(activeChat, me?.id, messages);
  // A chat is either a 1:1 secret chat or a secret group, never both — pick whichever is active.
  const { isSecret, safetyNumber, safetyQr, verification, markVerified, reVerify, keyHealth } =
    secret1to1;
  const isSecretGroup = secretGroup.isSecretGroup;
  const encryptForSend = isSecretGroup ? secretGroup.encryptForSend : secret1to1.encryptForSend;
  const displayMessages = isSecretGroup
    ? secretGroup.displayMessages
    : secret1to1.displayMessages;
  // Whether the composer must encrypt before sending — true for either secret mode.
  const encryptsOutbound = isSecret || isSecretGroup;
  const reduceMotion = useReducedMotion();

  /**
   * The shared social socket, for conversations that are *not* on screen.
   *
   * A conversation's own socket only exists while it is open, so a message arriving in another chat
   * moved nothing until the fifteen-second poll came round — the list was the one place in the app
   * that still felt like it needed reloading. The API now names the members of a chat when it moves
   * and sends them a thin frame; this turns that into a refetch of the list.
   */
  const onChatActivity = useCallback(
    (event: SocialEvent) => {
      if (event.type !== "chat_activity") return;
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    [queryClient]
  );
  useSocialEvents(onChatActivity);

  // Fetching the window is what clears the badge on the server, so the list is refreshed as
  // soon as that has happened instead of waiting out its own interval.
  //
  // A message the poll brought in — the socket having been down when it was sent — was never
  // marked read by anything, because only opening the thread does that. Saying so here covers
  // exactly that case, and costs one request per batch of arrivals rather than one per message.
  const seenCount = useRef(0);
  useEffect(() => {
    if (!activeId || !messages.length || seenCount.current === messages.length) return;
    seenCount.current = messages.length;
    queryClient.invalidateQueries({ queryKey: ["chats"] });
    if (typeof document !== "undefined" && !document.hidden) markRead();
  }, [activeId, markRead, messages.length, queryClient]);

  /**
   * The composer owns its own text and this is the handle onto it.
   *
   * It used to live here as `useState`, which meant every keystroke re-rendered this screen —
   * its header, the chat menu and the ten sheets mounted below — and typing visibly lagged
   * behind the keyboard. The field keeps its text to itself now; the screen only ever tells it
   * to seed, clear or focus.
   */
  const composer = useRef<ComposerHandle>(null);
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

  // Wrapped in `useCallback` because the memoised thread compares these by identity: a handler
  // rebuilt on every keystroke would re-render a hundred bubbles and undo the memo entirely.
  const setReplyTo = useCallback(
    (message: Message | null) => {
      setDraftContext({ chatId: activeId, reply: message, edit: null });
    },
    [activeId]
  );

  const beginEdit = useCallback(
    (message: Message) => {
      setDraftContext({ chatId: activeId, reply: null, edit: message });
      composer.current?.setText(message.content);
    },
    [activeId]
  );

  const cancelDraftContext = useCallback(() => {
    setDraftContext({ chatId: activeId, reply: null, edit: null });
    composer.current?.clear();
  }, [activeId]);

  /**
   * A picked image waits with its own chat id, so switching conversations discards it by
   * derivation rather than by an effect — the same trick the draft context uses.
   */
  const [pendingFile, setPendingFile] = useState<{
    chatId?: string;
    file: File;
    preview: string;
    /** Which of the three the upload is, so the composer previews it correctly. */
    kind: "image" | "video" | "file";
  } | null>(null);
  const attachment = pendingFile?.chatId === activeId ? pendingFile : null;

  function clearAttachment() {
    if (pendingFile) URL.revokeObjectURL(pendingFile.preview);
    setPendingFile(null);
  }

  const send = useMutation({
    /* The text arrives as the mutation's variable rather than from state up here — that is the
       whole point of the composer owning its field. */
    mutationFn: async (text: string) => {
      if (editing) return api.editMessage(activeId!, editing.id, text.trim());
      if (attachment) {
        return api.sendMessageMedia(activeId!, attachment.file, text.trim(), replyTo?.id);
      }
      // Secret chats: the body sent to the server is a ciphertext envelope, never the plaintext.
      const wire = encryptsOutbound ? await encryptForSend(text.trim()) : text.trim();
      return api.sendMessage(activeId!, wire, replyTo?.id);
    },
    /**
     * A sent message appears in the thread immediately, before the server answers.
     *
     * The round trip plus a refetch is a visible gap on a slow connection, and a gap after
     * pressing send is what makes people press it twice or reload the page. The temporary
     * bubble is the same shape as a real one, marked pending so the tick can wait; the
     * server's row replaces it when the refetch lands, and a failure restores the cache.
     *
     * Only a plain text send is optimistic: an edit rewrites an existing row and an upload has
     * no id or url until the server has stored the file.
     */
    onMutate: async (text: string) => {
      const key = ["messages", activeId] as const;
      if (editing || attachment || !me || !activeId) return { previous: undefined, key: null };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Message[]>(key);
      const clientKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Message = {
        id: clientKey,
        client_key: clientKey,
        pending: true,
        chat_id: activeId,
        sender_id: me.id,
        sender: me,
        content: text.trim(),
        created_at: new Date().toISOString(),
        is_mine: true,
        read: false,
        status: "sent",
        reply_to: replyTo
          ? {
              id: replyTo.id,
              sender_name: replyTo.sender?.display_name ?? "",
              content: replyTo.content
            }
          : null
      };
      queryClient.setQueryData<Message[]>(key, (current = []) => [...current, optimistic]);
      return { previous, key };
    },
    onSuccess: async (sent, _text, context) => {
      const wasEditing = Boolean(editing);
      cancelDraftContext();
      clearAttachment();
      /* Fold the server's row over the pending one before refetching, so the bubble is real
         immediately and the list never redraws it under a new key. */
      if (context?.key && sent && typeof sent === "object" && "id" in sent) {
        queryClient.setQueryData<Message[]>(context.key, (current) =>
          current ? mergeMessage(current, sent as Message) : current
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", activeId] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] })
      ]);
      if (wasEditing) notify("Message edited", { variant: "success" });
    },
    onError: (error: Error, _text, context) => {
      if (context?.key && context.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
      notify(editing ? "Couldn't edit" : "Message not sent", {
        variant: "error",
        detail: error.message
      });
    }
  });

  const [giftOpen, setGiftOpen] = useState(false);
  // A complaint about the conversation, or about one message in it.
  const [report, setReport] = useState<{ open: boolean; messageId?: string }>({ open: false });
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
    verifyKeys: boolean;
    selecting: boolean;
    picked: string[];
    forwarding: boolean;
  }>({
    info: false,
    searchOpen: false,
    search: "",
    appearance: false,
    wallpaper: false,
    verifyKeys: false,
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
          verifyKeys: false,
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

  const togglePicked = useCallback((id: string) => {
    setChatUi((current) => {
      const picked = current.picked.includes(id)
        ? current.picked.filter((item) => item !== id)
        : [...current.picked, id];
      return { ...current, chatId: activeId, picked };
    });
  }, [activeId]);

  /** Selection is checked once per row, so the list gets a set rather than an array. */
  const pickedSet = useMemo(() => new Set(ui.picked), [ui.picked]);

  // The thread's own handlers, stable for the same reason as the draft ones above.
  const startForward = useCallback(
    (item: Message) => setUi({ selecting: true, picked: [item.id], forwarding: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId]
  );
  const startSelect = useCallback(
    (item: Message) => setUi({ selecting: true, picked: [item.id] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId]
  );
  const startReport = useCallback(
    (item: Message) => setReport({ open: true, messageId: item.id }),
    []
  );

  const clearChat = useMutation({
    mutationFn: () => api.deleteChat(activeId!),
    onSuccess: async () => {
      setUi({ selecting: false, picked: [] });
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      await queryClient.invalidateQueries({ queryKey: ["messages", activeId] });
      notify("Chat cleared", { variant: "success", detail: "The history stays on the other side" });
    },
    onError: (error: Error) =>
      notify("Couldn't clear", { variant: "error", detail: error.message })
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
      notify(count === 1 ? "Message deleted" : `Deleted: ${count}`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't delete", { variant: "error", detail: error.message })
  });

  async function copyPicked() {
    const text = displayMessages
      .filter((item) => ui.picked.includes(item.id))
      .map((item) => item.content)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setUi({ selecting: false, picked: [] });
      notify("Copied", { variant: "success" });
    } catch {
      notify("Couldn't copy", {
        variant: "error",
        detail: "The browser denied clipboard access"
      });
    }
  }

  // Search narrows what is already loaded; the API has no message search yet. For secret chats
  // this searches the decrypted plaintext held on the device, never the ciphertext.
  const grouped = useMemo(() => {
    const needle = ui.search.trim().toLowerCase();
    return needle
      ? displayMessages.filter((item) => item.content.toLowerCase().includes(needle))
      : displayMessages;
  }, [displayMessages, ui.search]);
  // Only one message is pinned per chat, so the bar takes the first it finds. Uses the decrypted
  // view so a pinned secret message shows its plaintext in the pin bar rather than ciphertext.
  const pinnedMessage = useMemo(
    () => displayMessages.find((item) => item.pinned),
    [displayMessages]
  );

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
  /* Mirrored into a ref so the viewport-resize callback can read it without being rebuilt on every
     scroll — a keyboard opening mid-flick must see the position as of that moment. */
  const atBottomRef = useRef(true);
  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);
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

  /**
   * When the keyboard opens under a reader who was at the newest message, follow it down.
   *
   * Without this the viewport shrinks and the last bubble ends up above the fold — the message you
   * are replying to disappears the moment you tap the field. Only when already at the bottom: a
   * reader scrolled up into history stays where they are.
   */
  useEffect(() => {
    onViewportResize.current = () => {
      if (atBottomRef.current) jumpToBottom(false);
    };
  }, [jumpToBottom]);

  /**
   * While the chats screen is open, the document itself must not scroll.
   *
   * The shell is a scrolling column (`min-height: 100vh` on the body and the frame) and this screen
   * is a fixed-height pane. On a phone `100vh` overshoots the visible area, so the thread sat at the
   * top of a taller box with black below it, and the page could be dragged around under the
   * keyboard. The flag lets `globals.css` pin `html`/`body` for exactly as long as this screen is
   * mounted — the list included, since it is the same pane — and every other screen scrolls as
   * before.
   */
  useEffect(() => {
    document.documentElement.dataset.chatOpen = "true";
    return () => {
      delete document.documentElement.dataset.chatOpen;
    };
  }, []);

  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    setScrollState((current) => {
      const unseen = bottom || current.chatId !== activeId ? 0 : current.unseen;
      // Scroll fires on every frame, and this used to set state each time — re-rendering the
      // screen dozens of times per flick. Nothing here changes on most of those frames.
      if (current.chatId === activeId && current.atBottom === bottom && current.unseen === unseen) {
        return current;
      }
      return { chatId: activeId, atBottom: bottom, unseen };
    });
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

  /*
   * What the line under the title says, most urgent thing first.
   *
   * Typing wins over everything except a staff decision, because it is the only line here that is
   * true for a second and a half: presence, member counts and block states are all still true a
   * minute later, so making the reader wait for the next poll to see them costs nothing.
   */
  const typingLabel = !typing
    ? null
    : activeChat?.is_group
      ? `${typing.displayName} is typing…`
      : "typing…";
  const subtitle = !activeChat
    ? ""
    : // Staff decisions outrank the rest: a blocked account is why nothing else here works.
      activeChat.participant?.is_banned
      ? "blocked by administration"
      : (typingLabel ??
        (activeChat.is_group
          ? activeChat.is_secret
            ? `🔒 ${activeChat.members_count ?? 0} ${plural(activeChat.members_count ?? 0, "member", "members", "members")} · сквозное шифрование`
            : `${activeChat.members_count ?? 0} ${plural(activeChat.members_count ?? 0, "member", "members", "members")}`
          : activeChat.kind === "saved"
            ? "for your eyes only"
            : activeChat.kind === "secret"
              ? // A secret chat is end-to-end encrypted; the line also reflects key-verification state.
                verification === "changed"
                ? "⚠️ ключ собеседника изменился"
                : verification === "verified"
                  ? "🔒 проверено · сквозное шифрование"
                  : "🔒 сквозное шифрование"
              : // A closed conversation is the next thing worth knowing about it.
                activeChat.peer_blocked
                ? "blocked"
                : activeChat.blocked_by_peer
                  ? "you are blocked"
                  : activeChat.participant?.is_official
                    ? (activeChat.participant.role_title ?? "service notifications").toLowerCase()
                    : // Presence, worded once in `lib/presence` and reused by the profile.
                      presenceShort(activeChat.participant ?? { is_online: false }) ||
                      `@${activeChat.participant?.username ?? ""}`));

  return (
    <div
      /*
       * A pane fixed to the *visible* part of the screen, not to the document.
       *
       * `--chat-vh` is the visual viewport's height and `--chat-offset` is how far Safari has
       * scrolled the layout viewport to reveal a focused field. Sizing by the first alone left the
       * pane the right height in the wrong place: the keyboard pushed the document up, the pane went
       * with it, and its bottom edge — the composer — ended up at the top of the screen with the
       * page background below. `position: fixed` plus that offset keeps it exactly over what the
       * person can see, whatever the keyboard does.
       */
      className="chat-shell flex min-h-0 flex-col overflow-hidden"
      /* Both flags are read by `globals.css`. `data-chat-shell` covers the list *and* an open
         conversation — the whole screen is a fixed-height pane either way. `data-active-chat` is
         narrower: it also hides the dock and the compose button, which the list still needs. */
      data-chat-shell="true"
      data-active-chat={Boolean(activeChat)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <section className={`${activeChat ? "hidden" : "flex"} min-h-0 flex-1 flex-col overflow-y-auto`}>
          <ChatList chats={chats} isLoading={isLoading} activeId={activeId} />
        </section>

        {activeChat ? (
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Wallpaper sits behind the whole conversation, as in the reference. */}
            <div className="chat-wallpaper" aria-hidden />

            <header className="relative z-30 flex-none px-2 pb-1.5 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-2.5 sm:pb-2 sm:pt-[max(1rem,env(safe-area-inset-top))]">
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
                    Clear chat
                  </button>
                  <span className="min-w-0 flex-1 text-center text-[15px] font-semibold">
                    {ui.picked.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setUi({ selecting: false, picked: [] })}
                    className="h-9 flex-none rounded-full px-3 text-[15px] transition active:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
              <div className="chat-topbar">
                <button className="icon-button !size-10" onClick={() => router.push("/chats")} aria-label="Back to chat list"><ArrowLeft size={22} /></button>
                {/* The whole title block is the way into the info panel, as in the reference. */}
                <button
                  type="button"
                  onClick={() => setUi({ info: true })}
                  aria-label={activeChat.is_group ? "About the group" : "About the chat"}
                  className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 pr-1 text-left transition active:opacity-70"
                >
                  {activeChat.is_group || !activeChat.participant ? (
                    <UserAvatar
                      src={activeChat.avatar_url}
                      name={activeChat.title ?? "Chat"}
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
                <button className="icon-button !size-10" aria-label="Search the chat" onClick={() => setUi({ searchOpen: !ui.searchOpen })}><Search size={20} /></button>
                <ChatMenu
                  chat={activeChat}
                  onSearch={() => setUi({ searchOpen: true })}
                  onSendGift={() => setGiftOpen(true)}
                  onSelectMessages={() => setUi({ selecting: true, picked: [] })}
                  onOpenInfo={() => setUi({ info: true })}
                  onAppearance={() => setUi({ appearance: true })}
                  onWallpaper={() => setUi({ wallpaper: true })}
                  onVerifyKeys={() => setUi({ verifyKeys: true })}
                  onReport={() => setReport({ open: true, messageId: undefined })}
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
                  placeholder="Search messages"
                  aria-label="Search messages"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--dim)]"
                />
                <span className="flex-none text-xs text-[var(--dim)]">
                  {ui.search.trim() ? `${grouped.length} found` : null}
                </span>
                <button
                  type="button"
                  className="icon-button !size-8"
                  aria-label="Close search"
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
              /* `touch-pan-y` so a horizontal drag is not stolen from a swipeable child, and the
                 padding is tighter on a phone where the wallpaper margin is wasted width. */
              className="relative z-10 min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-clip overscroll-contain px-1.5 pb-1.5 sm:px-2.5 sm:pb-2"
            >
              <div className="mx-auto flex min-h-full max-w-[600px] flex-col gap-1">
                {/* An auto margin rather than `justify-end`: with justify-end a thread taller
                    than the viewport is clipped at the top and cannot be scrolled back to. */}
                <div aria-hidden className="mt-auto" />
                <MessageThread
                  messages={grouped}
                  chatId={activeChat.id}
                  group={activeChat.is_group}
                  selecting={ui.selecting}
                  picked={pickedSet}
                  onReply={setReplyTo}
                  onEdit={beginEdit}
                  onForward={startForward}
                  onSelect={startSelect}
                  onReport={startReport}
                  onToggleSelect={togglePicked}
                />
                {/* The bubble that is about to arrive. At the foot of the thread rather than only in
                    the header, because that is where the reader is already looking. */}
                <AnimatePresence initial={false}>
                  {typing ? (
                    <motion.div
                      key="typing"
                      initial={reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.96 }}
                      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-2 px-0.5 py-[3px]"
                    >
                      {activeChat.is_group ? (
                        <span className="order-first flex size-8 flex-none items-start">
                          <UserAvatar src={null} name={typing.displayName} size={32} />
                        </span>
                      ) : null}
                      <span className="typing-bubble" aria-live="polite">
                        <span aria-hidden />
                        <span aria-hidden />
                        <span aria-hidden />
                        <span className="sr-only">
                          {activeChat.is_group ? `${typing.displayName} is typing` : "typing"}
                        </span>
                      </span>
                    </motion.div>
                  ) : null}
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
                    {editing ? "Editing message" : `Reply to ${replyTo?.is_mine ? "yourself" : (activeChat.participant?.display_name ?? "the group")}`}
                  </strong>
                  <span className="block truncate text-[var(--muted)]">{(editing ?? replyTo)?.content}</span>
                </span>
                <button type="button" className="icon-button !size-7" aria-label="Cancel" onClick={cancelDraftContext}>
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
                  label="Delete"
                  danger
                  disabled={!ui.picked.length || deletePicked.isPending}
                  onClick={() => deletePicked.mutate()}
                />
                <SelectionAction
                  icon={Copy}
                  label="Copy"
                  disabled={!ui.picked.length}
                  onClick={copyPicked}
                />
                <SelectionAction
                  icon={CornerUpRight}
                  label="Forward"
                  disabled={!ui.picked.length}
                  onClick={() => setUi({ forwarding: true })}
                />
              </div>
            ) : activeChat.participant?.is_banned ? (
              /* Writing to a blocked account is refused by the server, so the composer says so
                 instead of collecting a message that cannot be delivered. */
              <div className="flex flex-none items-center justify-center gap-2 border-t border-[var(--line-structural)] bg-[var(--surface)] px-4 py-3.5 text-center text-[14px] text-[var(--muted)]">
                <Ban size={16} className="shrink-0 text-[var(--danger)]" />
                The account is blocked by administration — messaging is unavailable
              </div>
            ) : activeChat.peer_blocked || activeChat.blocked_by_peer ? (
              <BlockedBar chat={activeChat} />
            ) : (
              <MessageComposer
                ref={composer}
                onSubmit={(text) => {
                  if (!text.trim() && !attachment) return;
                  // The field empties the moment the bubble appears. Waiting for the server is
                  // what left typed text sitting in a field that looked like it had failed.
                  if (!editing && !attachment) composer.current?.clear();
                  send.mutate(text);
                }}
                onPickFile={(file) => {
                  clearAttachment();
                  setPendingFile({
                    chatId: activeId,
                    file,
                    preview: URL.createObjectURL(file),
                    /* Decided from the upload's declared type, the same way the API decides how to
                       store it — so the preview matches what will actually be sent. */
                    kind: file.type.startsWith("video/")
                      ? "video"
                      : file.type.startsWith("image/")
                        ? "image"
                        : "file"
                  });
                }}
                attachment={
                  attachment
                    ? {
                        name: attachment.file.name,
                        preview: attachment.preview,
                        kind: attachment.kind
                      }
                    : null
                }
                onClearAttachment={clearAttachment}
                editing={Boolean(editing)}
                pending={send.isPending}
                onTyping={notifyTyping}
              />
            )}
            <ChatGiftSheet chat={activeChat} open={giftOpen} onOpenChange={setGiftOpen} />
            <ChatReportSheet
              chatId={activeChat.id}
              messageId={report.messageId}
              subject={
                report.messageId
                  ? "Message in chat"
                  : activeChat.is_group
                    ? `Group «${activeChat.title ?? "untitled"}»`
                    : `Conversation with @${activeChat.participant?.username ?? ""}`
              }
              open={report.open}
              onOpenChange={(next) => setReport((current) => ({ ...current, open: next }))}
            />
            <ChatInfoPanel
              chat={activeChat}
              open={ui.info}
              onClose={() => setUi({ info: false })}
              onSendGift={() => setGiftOpen(true)}
              onVerifyKeys={() => setUi({ info: false, verifyKeys: true })}
            />
            {isSecret ? (
              <SafetyNumberSheet
                open={ui.verifyKeys}
                onOpenChange={(open) => setUi({ verifyKeys: open })}
                peerName={activeChat.participant?.display_name ?? `@${activeChat.participant?.username ?? ""}`}
                safetyNumber={safetyNumber}
                safetyQr={safetyQr}
                verification={verification}
                onMarkVerified={markVerified}
                onReVerify={reVerify}
                keyHealth={keyHealth}
              />
            ) : null}
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
      notify(result.detail, { variant: "success", detail: "The conversation is open again" });
    },
    onError: (error: Error) =>
      notify("Couldn't unblock", { variant: "error", detail: error.message })
  });

  return (
    <div className="relative z-20 flex-none border-t border-[var(--line)] bg-[var(--surface)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
      {chat.peer_blocked ? (
        <>
          <p className="m-0 mb-2 flex items-center justify-center gap-1.5 text-[13px] text-[var(--muted)]">
            <Ban size={14} className="text-[var(--danger)]" />
            You blocked {chat.participant?.display_name ?? "this user"}
          </p>
          <button
            type="button"
            onClick={() => unblock.mutate()}
            disabled={unblock.isPending || !peer}
            className="min-h-11 w-full rounded-[14px] text-[15px] font-bold text-[var(--danger)] transition active:scale-[0.99] disabled:opacity-50"
            style={{ background: "rgba(239,68,68,.14)" }}
          >
            {unblock.isPending ? "Unblocking…" : "Unblock"}
          </button>
        </>
      ) : (
        <p className="m-0 flex min-h-11 items-center justify-center gap-1.5 text-center text-[13px] text-[var(--muted)]">
          <Ban size={14} className="flex-none" />
          You can&apos;t message this user
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
          aria-label={unseen ? `Down, ${unseen} new` : "Down"}
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
      notify("Message unpinned", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't unpin", { variant: "error", detail: error.message })
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
          Pinned message
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
        aria-label="Unpin"
      >
        <X size={18} />
      </button>
    </div>
  );
}
