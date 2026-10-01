"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, BellOff, Check, Pin, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Chat, ChatFolder, Message } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { AdminMark } from "../admin-mark";
import { VerifiedMark } from "../verified-mark";
import { useToast } from "../ui/toast";
import { ChatListMenu, ChatRowMenu } from "./chat-list-menus";
import { NewChatLauncher } from "./new-chat-launcher";

type Filter = "all" | "pinned" | "archived";

/**
 * The conversation list column, following the reference: a sticky header with the title and
 * two round actions, a stories strip, the All/Pinned/Archive tabs, then 72px rows.
 */
export function ChatList({
  chats,
  isLoading,
  activeId
}: {
  chats: Chat[];
  isLoading: boolean;
  activeId?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  /** The feed menu links straight to the archive, so the tab can arrive in the URL. */
  const requestedFilter = params.get("filter");
  const [filter, setFilter] = useState<Filter>(
    requestedFilter === "archived" || requestedFilter === "pinned" ? requestedFilter : "all"
  );
  const [folderId, setFolderId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const folders = useQuery({ queryKey: ["chat-folders"], queryFn: api.chatFolders });
  const activeFolder = folders.data?.find((folder) => folder.id === folderId) ?? null;
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const stories = useQuery({
    queryKey: ["profile-stories", me?.username],
    queryFn: () => api.profileStories(me!.username),
    enabled: Boolean(me?.username)
  });

  const openSaved = useMutation({
    mutationFn: () => api.savedChat(),
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chats?chat=${chat.id}`);
    },
    onError: (error: Error) =>
      notify("Couldn't open Saved Messages", { variant: "error", detail: error.message })
  });

  const createFolder = useMutation({
    mutationFn: (title: string) => api.createChatFolder(title),
    onSuccess: async (folder) => {
      await queryClient.invalidateQueries({ queryKey: ["chat-folders"] });
      setFolderId(folder.id);
    }
  });
  const folderMembership = useMutation({
    mutationFn: ({ chatId, inside }: { chatId: string; inside: boolean }) =>
      inside ? api.removeChatFromFolder(folderId!, chatId) : api.addChatToFolder(folderId!, chatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-folders"] })
  });
  const removeFolder = useMutation({
    mutationFn: (id: string) => api.deleteChatFolder(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chat-folders"] });
      setFolderId(null);
    }
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (chat: Chat) =>
      !needle ||
      `${chat.title ?? ""} ${chat.participant?.display_name ?? ""} ${chat.participant?.username ?? ""} ${chat.last_message}`
        .toLowerCase()
        .includes(needle);
    // Archive is a separate shelf: an archived chat only appears under its own tab.
    const byFilter = (chat: Chat) =>
      filter === "archived" ? chat.archived : filter === "pinned" ? chat.pinned && !chat.archived : !chat.archived;
    const list = chats.filter((chat) => matches(chat) && byFilter(chat));
    if (!activeFolder) return list;
    const inside = (chat: Chat) => activeFolder.chat_ids.includes(chat.id);
    return list.slice().sort((a, b) => Number(inside(b)) - Number(inside(a)));
  }, [activeFolder, chats, filter, search]);

  const counts = useMemo(
    () => ({
      all: chats.filter((chat) => !chat.archived).reduce((sum, chat) => sum + chat.unread_count, 0),
      pinned: chats.filter((chat) => chat.pinned && !chat.archived).length,
      archived: chats.filter((chat) => chat.archived).length
    }),
    [chats]
  );

  return (
    <>
      <header className="sticky top-0 z-20 flex-none pt-4 backdrop-blur-xl">
        <div className="flex items-center gap-1 px-2 py-2">
          <h1 className="m-0 flex-1 truncate px-2 text-[20px] font-medium leading-7 tracking-[0.5px]">
            Messages
          </h1>
          <button
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen((open) => !open);
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition active:bg-white/10"
          >
            <Search size={22} />
          </button>
          <ChatListMenu onOpenSaved={() => openSaved.mutate()} />
        </div>

        {searchOpen ? (
          <div className="px-3 pb-2">
            <label className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] px-4">
              <Search size={18} className="flex-none text-[var(--muted)]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted)]"
              />
            </label>
          </div>
        ) : null}

        <StoriesStrip
          me={me?.username}
          name={me?.display_name}
          avatar={me?.avatar_url}
          count={stories.data?.length ?? 0}
        />

        <div className="folder-tabs px-1" role="tablist" aria-label="Chat filters">
          <FolderTab
            label="All"
            count={counts.all}
            active={filter === "all" && !folderId}
            onSelect={() => {
              setFilter("all");
              setFolderId(null);
            }}
          />
          <FolderTab
            label="Pinned"
            count={counts.pinned}
            active={filter === "pinned"}
            onSelect={() => {
              setFilter("pinned");
              setFolderId(null);
            }}
          />
          <FolderTab
            label="Archive"
            count={counts.archived}
            active={filter === "archived"}
            onSelect={() => {
              setFilter("archived");
              setFolderId(null);
            }}
          />
          {(folders.data ?? []).map((folder: ChatFolder) => (
            <FolderTab
              key={folder.id}
              label={folder.title}
              count={folder.unread_count}
              active={folder.id === folderId}
              onSelect={() => {
                setFolderId(folder.id);
                setFilter("all");
              }}
            />
          ))}
          <button
            type="button"
            aria-label="New folder"
            onClick={() => {
              const title = window.prompt("Folder name");
              if (title?.trim()) createFolder.mutate(title.trim());
            }}
            disabled={createFolder.isPending}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-medium text-[var(--muted)] transition active:bg-white/10"
          >
            <Plus size={17} />
          </button>
        </div>
      </header>

      {activeFolder ? (
        <div className="mx-3 mb-2 flex-none rounded-[16px] bg-[#121216] p-3 text-xs text-[var(--muted)] shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-white">{activeFolder.title}</strong>
            <button
              type="button"
              className="border-0 bg-transparent p-0 font-bold text-[var(--danger)]"
              onClick={() => removeFolder.mutate(activeFolder.id)}
              disabled={removeFolder.isPending}
            >
              Delete folder
            </button>
          </div>
          <p className="mb-0 mt-1">{activeFolder.chats_count} chats · tag conversations below</p>
        </div>
      ) : null}

      {/* Keyed by which shelf is showing, so «All» ⇄ «Pinned» ⇄ «Archive» ⇄ a folder fades the
          rows instead of swapping one column of avatars for another that looks just like it. */}
      <div key={folderId ?? filter} className="panel-enter min-h-[55dvh] px-1 pb-28">
        {isLoading
          ? [0, 1, 2, 3].map((index) => (
              <div key={index} className="flex h-[72px] items-center gap-3 px-3">
                <div className="skeleton size-[54px] rounded-full" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-28 rounded" />
                  <div className="skeleton mt-2.5 h-3 w-full rounded" />
                </div>
              </div>
            ))
          : null}
        {!isLoading && !visible.length ? (
          <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
            {filter === "archived"
              ? "Archive is empty"
              : filter === "pinned"
                ? "Nothing pinned"
                : search.trim()
                  ? "Nothing found"
                  : "Start your first conversation"}
          </p>
        ) : null}
        {visible.map((chat) => (
          <ChatRowMenu key={chat.id} chat={chat}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => router.push(`/chats?chat=${chat.id}`)}
                className="lift relative flex h-[72px] min-w-0 flex-1 items-center gap-3 rounded-[10px] px-3 text-left hover:bg-white/[0.045] active:bg-white/[0.07]"
                style={chat.id === activeId ? { background: "rgba(255,255,255,.06)" } : undefined}
              >
                <ChatAvatar chat={chat} />
                <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px] self-stretch py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      {chat.kind === "secret" ? (
                        <SecretGlyph />
                      ) : null}
                      <span
                        className="truncate text-[16px] font-semibold leading-[22px]"
                        style={{
                          color: chat.is_group
                            ? "var(--ink)"
                            : nameColor(chat.participant?.profile_color)
                        }}
                      >
                        {chat.title ?? chat.participant?.display_name}
                      </span>
                      {/* A group's title is its own; the marks of whoever happens to be the
                          first other member must not be pinned onto it. */}
                      {!chat.is_group && chat.participant?.verified ? <VerifiedMark size={15} /> : null}
                      {!chat.is_group && chat.participant?.is_admin ? <AdminMark size={14} /> : null}
                      {!chat.is_group && chat.participant?.is_premium ? (
                        <PremiumMark size={14} profileColor={chat.participant.profile_color} />
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 pl-1.5">
                      {chat.peer_blocked || chat.blocked_by_peer ? (
                        <Ban
                          size={13}
                          className="text-[var(--danger)]"
                          aria-label={chat.peer_blocked ? "You blocked them" : "You're blocked"}
                        />
                      ) : null}
                      {chat.muted ? (
                        <BellOff size={13} className="text-[var(--muted)]" aria-label="Muted" />
                      ) : null}
                      {chat.pinned ? <Pin size={13} className="text-[var(--muted)]" /> : null}
                      <span className="text-[12px] leading-4 text-[var(--muted)]">
                        {listTime(chat.updated_at)}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-[18px] text-[var(--muted)]">
                      {chat.is_typing ? (
                        <em className="not-italic text-[var(--link)]">typing…</em>
                      ) : (
                        preview(chat)
                      )}
                    </span>
                    {chat.unread_count ? (
                      <span className="inline-flex h-[22px] min-w-[22px] flex-none items-center justify-center rounded-full px-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--primary)" }}>
                        {chat.unread_count > 99 ? "99+" : chat.unread_count}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
              {activeFolder ? (
                <button
                  type="button"
                  className="mr-2 grid size-9 flex-none place-items-center rounded-full border-0"
                  style={
                    activeFolder.chat_ids.includes(chat.id)
                      ? { background: "var(--primary)", color: "white" }
                      : { background: "#121216", color: "var(--muted)" }
                  }
                  aria-label={
                    activeFolder.chat_ids.includes(chat.id)
                      ? `Remove from folder ${activeFolder.title}`
                      : `Add to folder ${activeFolder.title}`
                  }
                  aria-pressed={activeFolder.chat_ids.includes(chat.id)}
                  disabled={folderMembership.isPending}
                  onClick={() =>
                    folderMembership.mutate({
                      chatId: chat.id,
                      inside: activeFolder.chat_ids.includes(chat.id)
                    })
                  }
                >
                  {activeFolder.chat_ids.includes(chat.id) ? <Check size={17} /> : <Plus size={17} />}
                </button>
              ) : null}
            </div>
          </ChatRowMenu>
        ))}
      </div>
      <NewChatLauncher />
    </>
  );
}

/** A secret conversation is marked in the list itself, so it is never mistaken for a DM. */
function SecretGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      aria-label="Secret chat"
      role="img"
      className="flex-none text-emerald-400"
    >
      <path
        d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Groups and Saved Messages get a rounded square; a person keeps their circle. */
function ChatAvatar({ chat }: { chat: Chat }) {  if (chat.is_group || !chat.participant) {
    return (
      <UserAvatar
        src={chat.avatar_url}
        name={chat.title ?? "Chat"}
        size={54}
        radius={chat.kind === "saved" ? "50%" : "16px"}
      />
    );
  }
  return (
    <UserAvatar
      src={chat.participant.avatar_url}
      name={chat.participant.display_name}
      online={chat.participant.is_online}
      size={54}
    />
  );
}

/** Groups name the speaker in the preview, as the reference does. */
function preview(chat: Chat) {
  // A secret chat's last-message body is ciphertext the list cannot (and must not) decrypt — the
  // keys live only inside the open conversation. Show a neutral marker instead of raw JSON.
  const isSecret = chat.kind === "secret" || Boolean(chat.is_secret);
  const detail = chat.last_message_detail;
  if (isSecret) {
    if (detail?.service) return detail.content;
    return "🔒 Зашифрованное сообщение";
  }
  if (!detail) return looksEncrypted(chat.last_message) ? "🔒 Зашифрованное сообщение" : chat.last_message;
  if (detail.service) return detail.content;
  const text = detail.content || wordless(detail);
  if (chat.is_group && !detail.is_mine) return `${detail.sender.display_name}: ${text}`;
  return text;
}

/**
 * A cheap guard against ever flashing a ciphertext envelope in the list: if a body looks like one
 * of our E2EE wire envelopes (a JSON object carrying a `ct`/`dh` field), treat it as encrypted.
 * This is a belt-and-braces fallback for a chat whose secret flag has not loaded yet.
 */
function looksEncrypted(body: string | undefined): boolean {
  if (!body || body[0] !== "{") return false;
  return /"(ct|dh)"\s*:/.test(body);
}

/**
 * What a message with no text is called here.
 *
 * A shared story, a photo or a document left the row blank before this: the message carried
 * something, and the list said nothing about it.
 */
function wordless(detail: Message) {
  if (detail.story) return "Story";
  if (detail.gift) return "Gift";
  if (detail.media_kind === "video") return "Video";
  if (detail.media_url) return "Photo";
  if (detail.file_name) return `File · ${detail.file_name}`;
  return "";
}

function FolderTab({
  label,
  count,
  active,
  onSelect
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`folder-tab${active ? " is-active" : ""}`}
    >
      {label}
      {count > 0 ? (
        <span
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold"
          style={
            active
              ? { background: "var(--primary)", color: "#fff" }
              : { background: "rgba(255,255,255,.1)", color: "var(--muted)" }
          }
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The stories strip above the list. The reference's own ring is a split green/blue gradient,
 * and the tile carries a plus badge; with nothing posted it says so beside the tile.
 */
function StoriesStrip({
  me,
  name,
  avatar,
  count
}: {
  me?: string;
  name?: string;
  avatar?: string | null;
  count: number;
}) {
  return (
    <div className="px-3 pb-2 pt-1">
      <div className="flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link
          href={me ? `/u/${me}` : "/chats"}
          className="group flex min-w-[64px] flex-col items-center gap-1.5 text-center transition active:scale-95"
        >
          <span className="relative inline-flex">
            <span
              className="flex size-[56px] shrink-0 items-center justify-center rounded-full p-[2.5px]"
              style={{
                background: count
                  ? "linear-gradient(rgb(0,199,112) 0%, rgb(0,199,112) 50%, rgb(0,166,250) 50%, rgb(0,166,250) 100%)"
                  : "rgba(255,255,255,.12)"
              }}
            >
              <span className="flex size-full items-center justify-center rounded-full bg-black p-[2px]">
                <UserAvatar src={avatar} name={name ?? "Me"} size={48} />
              </span>
            </span>
            <span
              aria-hidden
              className="absolute -bottom-0.5 right-0 inline-flex size-5 items-center justify-center rounded-full border-[3px] border-black text-white"
              style={{ background: "var(--primary)" }}
            >
              <Plus size={11} />
            </span>
          </span>
          <span className="w-full truncate text-[11px] text-[var(--muted)]">My story</span>
        </Link>
        {!count ? (
          <div className="flex items-center px-2 text-xs text-[var(--dim)]">
            No active stories yet
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Today shows the clock, yesterday and this week their names, older the date. */
function listTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "yesterday";
  if (now.getTime() - date.getTime() < 6 * 864e5)
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" })
  }).format(date);
}
