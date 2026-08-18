"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
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
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Chat, User } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";
import { PremiumMarkExplained } from "../premium-mark";
import { VerifiedMark, VerifiedMarkExplained } from "../verified-mark";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useToast } from "../ui/toast";
import { PeoplePicker } from "./people-picker";

type Tab = "gifts" | "media" | "links" | "files";

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
      notify("Название обновлено", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось переименовать", { variant: "error", detail: error.message })
  });

  const addMembers = useMutation({
    mutationFn: (users: User[]) => api.addGroupMembers(chat.id, users.map((user) => user.username)),
    onSuccess: async (_chat, users) => {
      setAdding(false);
      await refresh();
      notify(users.length === 1 ? "Участник добавлен" : "Участники добавлены", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Не удалось добавить", { variant: "error", detail: error.message })
  });

  const kick = useMutation({
    mutationFn: (username: string) => api.removeGroupMember(chat.id, username),
    onSuccess: async (_result, username) => {
      await refresh();
      notify(`@${username} удалён(а) из группы`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить участника", { variant: "error", detail: error.message })
  });

  const leave = useMutation({
    mutationFn: () => api.removeGroupMember(chat.id, me!.username),
    onSuccess: async () => {
      setConfirmLeave(false);
      onClose();
      await refresh();
      router.push("/chats");
      notify("Вы вышли из группы", { variant: "success" });
    },
    onError: (error: Error) => notify("Не получилось", { variant: "error", detail: error.message })
  });

  const iAmOwner = (info.data?.members ?? []).some(
    (entry) => entry.is_owner && entry.user.id === me?.id
  );
  const peer = chat.participant;
  const subtitle = isGroup
    ? `${chat.members_count ?? info.data?.members.length ?? 0} участника`
    : chat.kind === "saved"
      ? "только для вас"
      : peer?.is_official
        ? (peer.role_title ?? "служебные уведомления").toLowerCase()
        : peer?.is_online
          ? "в сети"
          : `@${peer?.username ?? ""}`;
  const gifts = info.data?.gifts ?? [];
  const links = info.data?.links ?? [];

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="О чате"
            initial={reduceMotion ? undefined : { opacity: 0, x: 28 }}
            animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: 28 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[70] flex flex-col bg-[var(--sheet)] text-[var(--ink)]"
          >
            <div className="flex flex-none items-center gap-2 border-b border-[var(--sheet-line)] px-2 py-3">
              <button
                type="button"
                aria-label="Назад"
                onClick={onClose}
                className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="m-0 flex-1 text-[18px] font-medium">
                {isGroup ? "О группе" : "О чате"}
              </h2>
              {isGroup ? (
                <button
                  type="button"
                  aria-label="Добавить участников"
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
                    name={chat.title ?? "Чат"}
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
                      aria-label="Название группы"
                      className="min-w-0 flex-1 border-0 border-b border-[var(--sheet-line)] bg-transparent pb-1.5 text-center text-[19px] font-bold outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Сохранить название"
                      disabled={!draftTitle.trim() || rename.isPending}
                      onClick={() => rename.mutate()}
                      className="inline-flex size-9 items-center justify-center rounded-full text-white disabled:opacity-50"
                      style={{ background: "var(--primary)" }}
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label="Отменить"
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
                    aria-label="Переименовать группу"
                    className="flex items-center gap-2 border-0 bg-transparent p-0 text-[19px] font-bold"
                  >
                    {chat.title ?? "Группа"}
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
                        label="Личность подтверждена GRAM"
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
                    Секретный чат — переписка помечена и скрыта от общего поиска
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
                    Профиль
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
                    Подарок
                  </button>
                ) : null}
                {isGroup ? (
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(true)}
                    className="flex min-w-[86px] flex-col items-center gap-1.5 rounded-[16px] bg-white/[0.06] px-4 py-3 text-[12px] text-[var(--danger)] transition active:scale-95"
                  >
                    <LogOut size={20} />
                    Выйти
                  </button>
                ) : null}
              </div>

              {!isGroup && peer ? (
                <PeerAbout profile={peerProfile.data} peer={peer} loading={peerProfile.isLoading} />
              ) : null}

              {isGroup ? (
                <section className="mb-6">
                  <h3 className="m-0 px-4 pb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
                    Участники
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
                          владелец
                        </span>
                      ) : null}
                      {/* Only the owner can remove someone, and never themselves — leaving
                          is its own action with its own confirmation. */}
                      {iAmOwner && entry.user.id !== me?.id ? (
                        <button
                          type="button"
                          aria-label={`Удалить ${entry.user.display_name} из группы`}
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
                aria-label="Общие материалы"
                className="mx-4 mb-4 flex gap-1 rounded-[16px] bg-white/[0.04] p-1"
              >
                {(
                  [
                    // Gifts are collectibles, not attachments, so they get their own shelf.
                    ["gifts", `Подарки${gifts.length ? ` · ${gifts.length}` : ""}`],
                    ["media", "Медиа"],
                    ["links", `Ссылки${links.length ? ` · ${links.length}` : ""}`],
                    ["files", "Файлы"]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setView({ tab: key })}
                    className="flex-1 rounded-[13px] py-2 text-[13px] font-semibold transition"
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
                  <Empty icon={<Gift size={22} />} text="Подарков в этом чате пока нет" />
                )
              ) : null}

              {tab === "media" ? (
                <Empty
                  icon={<ImageIcon size={22} />}
                  text="Фото и видео появятся в следующем обновлении"
                />
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
                  <Empty icon={<Link2 size={22} />} text="Ссылок пока нет" />
                )
              ) : null}

              {tab === "files" ? (
                <Empty
                  icon={<Paperclip size={22} />}
                  text="Вложения появятся в следующем обновлении"
                />
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <PeoplePicker
        open={adding}
        onClose={() => setAdding(false)}
        title="Добавить участников"
        mode="multi"
        placeholder="Кого добавить"
        actionLabel="Добавить"
        pending={addMembers.isPending}
        excludeIds={(info.data?.members ?? []).map((entry) => entry.user.id)}
        onSubmit={(users) => addMembers.mutate(users)}
      />
      <ConfirmDialog
        open={Boolean(pendingKick)}
        onOpenChange={(next) => (next ? undefined : setPendingKick(null))}
        title="Удалить участника?"
        description={`@${pendingKick ?? ""} потеряет доступ к «${chat.title ?? "группе"}». Вернуть его можно только новым приглашением.`}
        confirmLabel={kick.isPending ? "Удаляем…" : "Удалить"}
        error={kick.error?.message}
        pending={kick.isPending}
        onConfirm={() => {
          if (pendingKick) kick.mutate(pendingKick, { onSuccess: () => setPendingKick(null) });
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Выйти из группы?"
        description={`Вы перестанете получать сообщения из «${chat.title ?? "группы"}». Вернуться сможете только по приглашению.`}
        confirmLabel={leave.isPending ? "Выходим…" : "Выйти"}
        error={leave.error?.message}
        pending={leave.isPending}
        onConfirm={() => leave.mutate()}
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
    rows.push({ key: "city", icon: <MapPin size={17} />, label: "Город", value: person.location });
  }
  if (person.website_url) {
    rows.push({
      key: "site",
      icon: <Link2 size={17} />,
      label: "Ссылка",
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
      label: "В GRAM с",
      value: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
        new Date(person.joined_at)
      )
    });
  }
  if (typeof person.followers_count === "number") {
    rows.push({
      key: "followers",
      icon: <Users size={17} />,
      label: "Подписчики",
      value: `${person.followers_count} · ${person.following_count ?? 0} подписок`
    });
  }

  const bio = profile?.bio?.trim();
  if (!bio && !rows.length) {
    return loading ? <div className="mx-4 mb-6 h-16 rounded-[16px] bg-white/[0.04]" /> : null;
  }
  return (
    <section className="mb-6 px-4">
      <h3 className="m-0 pb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
        О пользователе
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
