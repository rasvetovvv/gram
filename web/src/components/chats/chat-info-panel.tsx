"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Download,
  Gift,
  Image as ImageIcon,
  Link2,
  LogOut,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  UserMinus,
  UserPlus,
  Users,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { API_URL, api } from "@/lib/api";
import type { Chat, User } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";
import { PremiumMarkExplained } from "../premium-mark";
import { VerifiedMark, VerifiedMarkExplained } from "../verified-mark";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { MediaViewer } from "../ui/media-viewer";
import { useToast } from "../ui/toast";
import { GroupAccessBlock } from "./group-access-block";
import { PeoplePicker } from "./people-picker";
import { VideoBadge, readableSize } from "./message-attachments";

type Tab = "gifts" | "media" | "links" | "files";

/** One formatter for every shelf row, built once rather than per render. */
const SHARED_AT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

/**
 * The panel behind the conversation header, reached by tapping the title — the reference's
 * own `.chat-info-container` affordance. It answers "who is this", "who else is here" and
 * "what was shared", and for a group it is also where the name is edited.
 */
export function ChatInfoPanel({
  chat,
  open,
  onClose,
  onSendGift
}: {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  onSendGift: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  /**
   * Tab, rename mode and the name draft belong to one open panel, so they hang off a key
   * and are derived back to defaults when it closes — no reset effect needed.
   */
  const panelKey = open ? chat.id : "";
  const [panelState, setPanelState] = useState<{
    key: string;
    tab: Tab;
    renaming: boolean;
    draftTitle: string;
  }>({ key: "", tab: "gifts", renaming: false, draftTitle: "" });
  const view =
    panelState.key === panelKey
      ? panelState
      : { tab: "gifts" as Tab, renaming: false, draftTitle: chat.title ?? "" };
  const setView = (patch: Partial<typeof panelState>) =>
    setPanelState({ ...view, key: panelKey, ...patch });
  const { tab, renaming, draftTitle } = view;
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingKick, setPendingKick] = useState<string | null>(null);
  const isGroup = Boolean(chat.is_group);

  const info = useQuery({
    queryKey: ["chat-info", chat.id],
    queryFn: () => api.chatInfo(chat.id),
    enabled: open
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: open });
  /**
   * The peer's own profile, so the panel answers "who is this" in their words rather than
   * only with a handle. `chat.participant` is the compact user and carries no bio by design,
   * so this reads the same public profile the profile screen does — and shares its cache key.
   */
  const peerUsername = chat.is_group ? undefined : chat.participant?.username;
  const peerProfile = useQuery({
    queryKey: ["profile", peerUsername],
    queryFn: () => api.profile(peerUsername!),
    enabled: open && Boolean(peerUsername)
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chat-info", chat.id] }),
      queryClient.invalidateQueries({ queryKey: ["chats"] }),
      queryClient.invalidateQueries({ queryKey: ["messages", chat.id] })
    ]);

  const rename = useMutation({
    mutationFn: () => api.updateGroupChat(chat.id, { title: draftTitle.trim() }),
    onSuccess: async () => {
      setView({ renaming: false });
      await refresh();
      notify("Name updated", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't rename", { variant: "error", detail: error.message })
  });

  const addMembers = useMutation({
    mutationFn: (users: User[]) => api.addGroupMembers(chat.id, users.map((user) => user.username)),
    onSuccess: async (_chat, users) => {
      setAdding(false);
      await refresh();
      notify(users.length === 1 ? "Member added" : "Members added", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Couldn't add", { variant: "error", detail: error.message })
  });

  const kick = useMutation({
    mutationFn: (username: string) => api.removeGroupMember(chat.id, username),
    onSuccess: async (_result, username) => {
      await refresh();
      notify(`@${username} removed from the group`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't remove member", { variant: "error", detail: error.message })
  });

  const leave = useMutation({
    mutationFn: () => api.removeGroupMember(chat.id, me!.username),
    onSuccess: async () => {
      setConfirmLeave(false);
      onClose();
      await refresh();
      router.push("/chats");
      notify("You left the group", { variant: "success" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });

  const iAmOwner = (info.data?.members ?? []).some(
    (entry) => entry.is_owner && entry.user.id === me?.id
  );
  const peer = chat.participant;
  const subtitle = isGroup
    ? `${chat.members_count ?? info.data?.members.length ?? 0} members`
    : chat.kind === "saved"
      ? "just for you"
      : peer?.is_official
        ? (peer.role_title ?? "service notifications").toLowerCase()
        : peer?.is_online
          ? "online"
          : `@${peer?.username ?? ""}`;
  const gifts = info.data?.gifts ?? [];
  const links = info.data?.links ?? [];
  const files = info.data?.files ?? [];

  /**
   * Pictures and clips shared here, and which of them the full-screen viewer is showing.
   *
   * `media` is memoised rather than defaulted inline: `?? []` builds a new array on every render,
   * which would rebuild the viewer's item list on every render too.
   */
  const media = useMemo(() => info.data?.media ?? [], [info.data?.media]);
  const [viewer, setViewer] = useState<number | null>(null);
  const viewerItems = useMemo(
    () =>
      media.map((item) => ({
        url: item.url,
        kind: item.kind === "video" ? ("video" as const) : ("image" as const),
        caption: `${item.sender_name} · ${SHARED_AT.format(new Date(item.created_at))}`
      })),
    [media]
  );

  /**
   * Close the panel and put the message on screen.
   *
   * A shelf that only shows *what* was shared is half an answer; the other half is where it sits
   * in the conversation. The row has to be scrolled to after the panel's exit animation has
   * released the layout, hence the frame's delay.
   */
  function jumpTo(messageId: string) {
    onClose();
    setTimeout(() => {
      document
        .getElementById(`message-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 220);
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="About chat"
            initial={reduceMotion ? undefined : { opacity: 0, x: 28 }}
            animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: 28 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[70] flex flex-col bg-[var(--sheet)] text-[var(--ink)]"
          >
            <div className="flex flex-none items-center gap-2 border-b border-[var(--sheet-line)] px-2 py-3">
              <button
                type="button"
                aria-label="Back"
                onClick={onClose}
                className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="m-0 flex-1 text-[18px] font-medium">
                {isGroup ? "About group" : "About chat"}
              </h2>
              {isGroup ? (
                <button
                  type="button"
                  aria-label="Add members"
                  onClick={() => setAdding(true)}
                  className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
                >
                  <UserPlus size={21} />
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-10">
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                {isGroup || !peer ? (
                  <UserAvatar
                    src={chat.avatar_url}
                    name={chat.title ?? "Chat"}
                    size={96}
                    radius="28px"
                  />
                ) : (
                  <UserAvatar
                    src={peer.avatar_url}
                    name={peer.display_name}
                    online={peer.is_online}
                    size={96}
                  />
                )}
                {renaming ? (
                  <div className="flex w-full max-w-sm items-center gap-2">
                    <input
                      autoFocus
                      value={draftTitle}
                      maxLength={100}
                      onChange={(event) => setView({ draftTitle: event.target.value })}
                      aria-label="Group name"
                      className="min-w-0 flex-1 border-0 border-b border-[var(--sheet-line)] bg-transparent pb-1.5 text-center text-[19px] font-bold outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Save name"
                      disabled={!draftTitle.trim() || rename.isPending}
                      onClick={() => rename.mutate()}
                      className="inline-flex size-9 items-center justify-center rounded-full text-white disabled:opacity-50"
                      style={{ background: "var(--primary)" }}
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel"
                      onClick={() => {
                        setView({ renaming: false, draftTitle: chat.title ?? "" });
                      }}
                      className="inline-flex size-9 items-center justify-center rounded-full bg-white/[0.06]"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : isGroup ? (
                  <button
                    type="button"
                    // A group's name is edited by tapping it, as in the reference.
                    onClick={() => setView({ renaming: true })}
                    aria-label="Rename group"
                    className="flex items-center gap-2 border-0 bg-transparent p-0 text-[19px] font-bold"
                  >
                    {chat.title ?? "Group"}
                    <Pencil size={15} className="text-[var(--muted)]" />
                  </button>
                ) : (
                  // A person's name is not ours to change, so it is text rather than a disabled
                  // button — which is also what frees the marks to be their own controls. Inside
                  // the old wrapper the outer button swallowed every tap on them.
                  <div className="flex items-center gap-2 text-[19px] font-bold">
                    <span style={{ color: nameColor(peer?.profile_color) }}>
                      {peer?.display_name ?? chat.title}
                    </span>
                    {peer?.verified ? (
                      <VerifiedMarkExplained
                        name={peer.display_name}
                        label="Identity verified by GRAM"
                        size={17}
                      />
                    ) : null}
                    {peer?.is_premium ? (
                      <PremiumMarkExplained
                        name={peer.display_name}
                        size={16}
                        profileColor={peer.profile_color}
                      />
                    ) : null}
                  </div>
                )}
                <p className="m-0 text-[13px] text-[var(--muted)]">{subtitle}</p>
                {chat.kind === "secret" ? (
                  <p className="m-0 text-[12px] text-emerald-400/80">
                    Secret chat — the conversation is flagged and hidden from general search
                  </p>
                ) : null}
              </div>

              <div className="flex justify-center gap-2 px-4 pb-6">
                {!isGroup && peer ? (
                  <Link
                    href={`/u/${peer.username}`}
                    className="flex min-w-[86px] flex-col items-center gap-1.5 rounded-[16px] bg-white/[0.06] px-4 py-3 text-[12px] text-[var(--muted)] transition active:scale-95"
                  >
                    <MessageSquare size={20} className="text-[var(--ink)]" />
                    Profile
                  </Link>
                ) : null}
                {!isGroup && peer ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSendGift();
                    }}
                    className="flex min-w-[86px] flex-col items-center gap-1.5 rounded-[16px] bg-white/[0.06] px-4 py-3 text-[12px] text-[var(--muted)] transition active:scale-95"
                  >
                    <Gift size={20} className="text-[var(--ink)]" />
                    Gift
                  </button>
                ) : null}
                {isGroup ? (
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(true)}
                    className="flex min-w-[86px] flex-col items-center gap-1.5 rounded-[16px] bg-white/[0.06] px-4 py-3 text-[12px] text-[var(--danger)] transition active:scale-95"
                  >
                    <LogOut size={20} />
                    Leave
                  </button>
                ) : null}
              </div>

              {!isGroup && peer ? (
                <PeerAbout profile={peerProfile.data} peer={peer} loading={peerProfile.isLoading} />
              ) : null}

              {isGroup ? <GroupAccessBlock chat={chat} /> : null}

              {isGroup ? (
                <section className="mb-6">
                  <h3 className="m-0 px-4 pb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
                    Members
                  </h3>
                  {(info.data?.members ?? []).map((entry) => (
                    <div key={entry.user.id} className="flex items-center gap-3 px-4 py-2">
                      <UserAvatar
                        src={entry.user.avatar_url}
                        name={entry.user.display_name}
                        online={entry.user.is_online}
                        size={42}
                      />
                      <Link href={`/u/${entry.user.username}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="truncate text-[15px]"
                            style={{ color: nameColor(entry.user.profile_color) }}
                          >
                            {entry.user.display_name}
                          </span>
                          {entry.user.verified ? <VerifiedMark size={14} /> : null}
                        </span>
                        <span className="block truncate text-[13px] text-[var(--muted)]">
                          @{entry.user.username}
                        </span>
                      </Link>
                      {entry.is_owner ? (
                        <span className="flex-none rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          owner
                        </span>
                      ) : null}
                      {/* Only the owner can remove someone, and never themselves — leaving
                          is its own action with its own confirmation. */}
                      {iAmOwner && entry.user.id !== me?.id ? (
                        <button
                          type="button"
                          aria-label={`Remove ${entry.user.display_name} from the group`}
                          onClick={() => setPendingKick(entry.user.username)}
                          disabled={kick.isPending}
                          className="grid size-9 flex-none place-items-center rounded-full text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--danger)]"
                        >
                          <UserMinus size={18} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}

              <div
                role="tablist"
                aria-label="Shared content"
                className="mx-4 mb-4 flex gap-1 rounded-[16px] bg-white/[0.04] p-1"
              >
                {(
                  [
                    // Gifts are collectibles, not attachments, so they get their own shelf.
                    ["gifts", `Gifts${gifts.length ? ` · ${gifts.length}` : ""}`],
                    ["media", `Media${media.length ? ` · ${media.length}` : ""}`],
                    ["links", `Links${links.length ? ` · ${links.length}` : ""}`],
                    ["files", `Files${files.length ? ` · ${files.length}` : ""}`]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setView({ tab: key })}
                    /* 44px tall: these were 33px, which is under the smallest target a thumb hits
                       reliably — and they are the only way into the media shelf. */
                    className="min-h-11 flex-1 rounded-[13px] px-1 text-[13px] font-semibold transition"
                    style={
                      tab === key
                        ? { background: "rgba(109,95,196,.22)", color: "var(--identity)" }
                        : { color: "var(--muted)" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "gifts" ? (
                gifts.length ? (
                  <div className="grid grid-cols-3 gap-1.5 px-4">
                    {gifts.map((gift) => (
                      <span
                        key={gift.id}
                        className="grid aspect-square place-items-center rounded-[12px] p-2"
                        style={{ background: gift.accent || "#2a2e37" }}
                        title={`${gift.name} #${gift.serial_number}`}
                      >
                        <GiftImage
                          {...giftArtProps(gift)}
                          size={82}
                          rounded="rounded-[10px]"
                        />
                      </span>
                    ))}
                  </div>
                ) : (
                  <Empty icon={<Gift size={22} />} text="No gifts in this chat yet" />
                )
              ) : null}

              {tab === "media" ? (
                media.length ? (
                  /* A square grid, newest first. Tapping a tile opens the full-screen viewer and
                     swipes through the whole shelf; the long-press-style "where was this sent"
                     answer moved to its own button, because opening the picture is what everybody
                     actually wants from a gallery tile. */
                  <div className="grid grid-cols-3 gap-1.5 px-4">
                    {media.map((item, position) => (
                      <span
                        key={`${item.message_id}-${item.url}`}
                        className="relative block aspect-square overflow-hidden rounded-[12px] bg-white/[0.04]"
                      >
                        <button
                          type="button"
                          onClick={() => setViewer(position)}
                          title={`${item.sender_name} · ${SHARED_AT.format(new Date(item.created_at))}`}
                          aria-label={`Open ${item.kind === "video" ? "video" : "photo"} from ${item.sender_name}`}
                          className="block size-full transition active:scale-95"
                        >
                          {item.kind === "video" ? (
                            /* A clip has no separate poster, so the element itself supplies the
                               first frame; `metadata` fetches just enough for that, and a user's
                               upload carries no caption track. */
                            <video
                              src={`${item.url}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                              tabIndex={-1}
                              className="size-full object-cover"
                            />
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media, not the Next image pipeline */
                            <img
                              src={item.url}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          )}
                          {item.kind === "video" ? <VideoBadge /> : null}
                        </button>
                        {/* Straight to the message it came from — a 28px target in the corner,
                            which is reachable on a phone where a long-press is not discoverable. */}
                        <button
                          type="button"
                          onClick={() => jumpTo(item.message_id)}
                          aria-label="Show in conversation"
                          title="Show in conversation"
                          className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition active:scale-90"
                        >
                          <MessageSquare size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <Empty icon={<ImageIcon size={22} />} text="No photos or videos shared yet" />
                )
              ) : null}

              {tab === "links" ? (
                links.length ? (
                  <ul className="m-0 list-none space-y-1 px-4">
                    {links.map((link, index) => (
                      <li key={`${link.message_id}-${index}`}>
                        <a
                          href={link.url.startsWith("http") ? link.url : `https://${link.url}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-3 rounded-[14px] px-2 py-2.5 transition hover:bg-white/[0.04]"
                        >
                          <span className="grid size-10 flex-none place-items-center rounded-[12px] bg-white/[0.06] text-[var(--link)]">
                            <Link2 size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] text-[var(--link)]">
                              {link.url}
                            </span>
                            <span className="block truncate text-[12px] text-[var(--muted)]">
                              {link.sender_name}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty icon={<Link2 size={22} />} text="No links yet" />
                )
              ) : null}

              {tab === "files" ? (
                files.length ? (
                  <ul className="m-0 list-none space-y-1 px-4">
                    {files.map((item) => (
                      <li key={`${item.message_id}-${item.url}`}>
                        <a
                          href={item.url.startsWith("http") ? item.url : `${API_URL}${item.url}`}
                          download={item.name ?? "File"}
                          className="flex items-center gap-3 rounded-[14px] px-2 py-2.5 transition hover:bg-white/[0.04]"
                        >
                          <span className="grid size-10 flex-none place-items-center rounded-[12px] bg-white/[0.06] text-[var(--primary-strong)]">
                            <Paperclip size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">
                              {item.name ?? "File"}
                            </span>
                            <span className="block truncate text-[12px] text-[var(--muted)]">
                              {item.sender_name}
                              {typeof item.size === "number" ? ` · ${readableSize(item.size)}` : ""}
                              {` · ${SHARED_AT.format(new Date(item.created_at))}`}
                            </span>
                          </span>
                          <Download size={16} className="flex-none text-[var(--muted)]" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty icon={<Paperclip size={22} />} text="No files yet" />
                )
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <PeoplePicker
        open={adding}
        onClose={() => setAdding(false)}
        title="Add members"
        mode="multi"
        placeholder="Who to add"
        actionLabel="Add"
        pending={addMembers.isPending}
        excludeIds={(info.data?.members ?? []).map((entry) => entry.user.id)}
        onSubmit={(users) => addMembers.mutate(users)}
      />
      <ConfirmDialog
        open={Boolean(pendingKick)}
        onOpenChange={(next) => (next ? undefined : setPendingKick(null))}
        title="Remove member?"
        description={`@${pendingKick ?? ""} will lose access to “${chat.title ?? "the group"}”. You can only bring them back with a new invitation.`}
        confirmLabel={kick.isPending ? "Removing…" : "Remove"}
        error={kick.error?.message}
        pending={kick.isPending}
        onConfirm={() => {
          if (pendingKick) kick.mutate(pendingKick, { onSuccess: () => setPendingKick(null) });
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave group?"
        description={`You'll stop receiving messages from “${chat.title ?? "the group"}”. You can only return by invitation.`}
        confirmLabel={leave.isPending ? "Leaving…" : "Leave"}
        error={leave.error?.message}
        pending={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
      {/* Outside the panel's own `AnimatePresence`: the viewer must survive the panel closing
          behind it, and it draws over everything anyway. */}
      <MediaViewer
        items={viewerItems}
        index={viewer}
        onClose={() => setViewer(null)}
        onIndex={setViewer}
      />
    </>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13px] text-[var(--muted)]">
      <span className="grid size-11 place-items-center rounded-full bg-white/[0.05]">{icon}</span>
      {text}
    </div>
  );
}

/**
 * Who the other person is, in their own words.
 *
 * The panel used to show a handle and nothing else, so tapping the chat header answered
 * "which conversation" but never "who is this". The compact user in `chat.participant`
 * deliberately carries no bio, so the text comes from their public profile.
 */
function PeerAbout({
  profile,
  peer,
  loading
}: {
  profile: User | undefined;
  peer: User;
  loading: boolean;
}) {
  const person = profile ?? peer;
  const rows: { key: string; icon: React.ReactNode; label: string; value: React.ReactNode }[] = [];
  if (person.location) {
    rows.push({ key: "city", icon: <MapPin size={17} />, label: "City", value: person.location });
  }
  if (person.website_url) {
    rows.push({
      key: "site",
      icon: <Link2 size={17} />,
      label: "Link",
      value: (
        <a
          href={person.website_url.startsWith("http") ? person.website_url : `https://${person.website_url}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--link)]"
        >
          {person.website_url.replace(/^https?:\/\//, "")}
        </a>
      )
    });
  }
  if (person.joined_at) {
    rows.push({
      key: "joined",
      icon: <CalendarDays size={17} />,
      label: "On GRAM since",
      value: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
        new Date(person.joined_at)
      )
    });
  }
  if (typeof person.followers_count === "number") {
    rows.push({
      key: "followers",
      icon: <Users size={17} />,
      label: "Followers",
      value: `${person.followers_count} · ${person.following_count ?? 0} following`
    });
  }

  const bio = profile?.bio?.trim();
  if (!bio && !rows.length) {
    return loading ? <div className="mx-4 mb-6 h-16 rounded-[16px] bg-white/[0.04]" /> : null;
  }
  return (
    <section className="mb-6 px-4">
      <h3 className="m-0 pb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
        About
      </h3>
      <div className="rounded-[16px] bg-white/[0.04] px-3.5 py-3">
        {bio ? (
          <p className="m-0 whitespace-pre-wrap text-[15px] leading-6 text-[var(--ink)]">{bio}</p>
        ) : null}
        {person.role_title ? (
          <p className="mb-0 mt-1 text-[13px] font-semibold text-[var(--muted)]">
            {person.role_title}
          </p>
        ) : null}
        {rows.length ? (
          <dl className={`m-0 grid gap-2 ${bio || person.role_title ? "mt-3 border-t border-white/[0.06] pt-3" : ""}`}>
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2.5 text-[14px]">
                <span className="flex-none text-[var(--muted)]">{row.icon}</span>
                <dt className="sr-only">{row.label}</dt>
                <dd className="m-0 min-w-0 flex-1 truncate text-[var(--ink)]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </section>
  );
}
