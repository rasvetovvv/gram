"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Flag,
  Bell,
  BellOff,
  Brush,
  Check,
  CheckSquare,
  ChevronRight,
  Gift,
  Image as ImageIcon,
  Info,
  Languages,
  LogOut,
  MoreHorizontal,
  Phone,
  Search,
  ShieldCheck,
  Timer,
  Trash2,
  Video
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Chat } from "@/lib/types";
import { useToast } from "../ui/toast";

/**
 * Chat menu, copied from the reference's own two lists: a direct chat offers calls, a gift,
 * blocking and deletion; a group offers its information sheet and a way out. Panel geometry
 * follows the reference too — 266px wide, translucent `--menu` surface, 16px radius, 32px rows.
 *
 * Only calls and translation are still promises; everything else here does what it says.
 */
const SOON = "Появится в следующем обновлении";
const PANEL =
  "z-[95] max-h-[calc(100dvh-5rem)] w-[266px] max-w-[calc(100vw-1.25rem)] overflow-y-auto overscroll-contain rounded-[16px] py-1 shadow-[0_18px_50px_rgba(0,0,0,.55)]";
const PANEL_STYLE = { background: "var(--menu)", backdropFilter: "var(--menu-blur)" } as const;
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 px-4 text-[16px] outline-none focus:bg-white/[0.06] data-[highlighted]:bg-white/[0.06]";
const RULE = "mx-3 my-1 h-px border-0 bg-white/[0.06]";

/** The reference's own four windows, and how each is named once chosen. */
const AUTODELETE_OPTIONS: { seconds: 0 | 86400 | 604800 | 2592000; label: string }[] = [
  { seconds: 0, label: "Выключено" },
  { seconds: 86400, label: "1 день" },
  { seconds: 604800, label: "1 неделя" },
  { seconds: 2592000, label: "1 месяц" }
];

export function autodeleteLabel(seconds: number | undefined) {
  return AUTODELETE_OPTIONS.find((option) => option.seconds === (seconds ?? 0))?.label ?? "Выключено";
}

export function ChatMenu({
  chat,
  onSearch,
  onSendGift,
  onSelectMessages,
  onOpenInfo,
  onAppearance,
  onWallpaper,
  onReport
}: {
  chat: Chat;
  onSearch: () => void;
  onSendGift: () => void;
  onSelectMessages: () => void;
  onReport: () => void;
  onOpenInfo: () => void;
  onAppearance: () => void;
  onWallpaper: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const isGroup = Boolean(chat.is_group);
  const peer = chat.participant?.username;

  const soon = (label: string) => () => notify(label, { variant: "info", detail: SOON });

  const refreshChats = () => queryClient.invalidateQueries({ queryKey: ["chats"] });

  const mute = useMutation({
    mutationFn: () => api.updateChatState(chat.id, { muted: !chat.muted }),
    onSuccess: async (updated) => {
      await refreshChats();
      notify(updated.muted ? "Уведомления выключены" : "Уведомления включены", {
        variant: "success",
        detail: updated.muted ? "Счётчик непрочитанных останется" : undefined
      });
    },
    onError: (error: Error) => notify("Не удалось изменить", { variant: "error", detail: error.message })
  });

  const autodelete = useMutation({
    mutationFn: (seconds: 0 | 86400 | 604800 | 2592000) => api.setChatAutodelete(chat.id, seconds),
    onSuccess: async (updated) => {
      await Promise.all([refreshChats(), queryClient.invalidateQueries({ queryKey: ["messages", chat.id] })]);
      notify(
        updated.autodelete_seconds
          ? `Автоудаление: ${autodeleteLabel(updated.autodelete_seconds)}`
          : "Автоудаление выключено",
        { variant: "success" }
      );
    },
    onError: (error: Error) => notify("Не удалось изменить", { variant: "error", detail: error.message })
  });

  const block = useMutation({
    mutationFn: () => {
      if (!peer) return Promise.reject(new Error("Нет получателя"));
      return chat.peer_blocked ? api.unblockUser(peer) : api.blockUser(peer);
    },
    onSuccess: async (result) => {
      const wasBlocked = chat.peer_blocked;
      await Promise.all([refreshChats(), queryClient.invalidateQueries({ queryKey: ["profile", peer] })]);
      notify(result.detail, {
        variant: "success",
        detail: wasBlocked ? "Переписка снова открыта" : "Переписка закрыта с обеих сторон"
      });
      // Unblocking leaves you where you are; blocking closes the conversation you were in.
      if (!wasBlocked) router.push("/chats");
    },
    onError: (error: Error) =>
      notify(chat.peer_blocked ? "Не удалось разблокировать" : "Не удалось заблокировать", {
        variant: "error",
        detail: error.message
      })
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: async () => {
      await refreshChats();
      notify("Чат удалён", { variant: "success", detail: "У собеседника история осталась" });
      router.push("/chats");
    },
    onError: (error: Error) => notify("Не удалось удалить", { variant: "error", detail: error.message })
  });

  const leave = useMutation({
    mutationFn: async () => {
      const me = await api.currentUser();
      return api.removeGroupMember(chat.id, me.username);
    },
    onSuccess: async () => {
      await refreshChats();
      notify("Вы покинули группу", { variant: "success" });
      router.push("/chats");
    },
    onError: (error: Error) => notify("Не удалось выйти", { variant: "error", detail: error.message })
  });

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="icon-button" aria-label="Меню">
          <MoreHorizontal size={21} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={10} className={PANEL} style={PANEL_STYLE}>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={ROW}>
              <Timer size={18} className="text-[var(--muted)]" />
              <span className="flex-1">Автоудаление</span>
              <span className="text-[13px] text-[var(--muted)]">{autodeleteLabel(chat.autodelete_seconds)}</span>
              <ChevronRight size={16} className="text-[var(--muted)]" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                sideOffset={4}
                className={`${PANEL} !w-[180px]`}
                style={PANEL_STYLE}
              >
                <p className="m-0 px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--faint)]">
                  Автоудаление
                </p>
                {AUTODELETE_OPTIONS.map((option) => (
                  <DropdownMenu.Item
                    key={option.seconds}
                    className={ROW}
                    disabled={autodelete.isPending}
                    onSelect={() => autodelete.mutate(option.seconds)}
                  >
                    <span className="flex-1">{option.label}</span>
                    {(chat.autodelete_seconds ?? 0) === option.seconds ? (
                      <Check size={16} className="text-[var(--primary-strong)]" />
                    ) : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          <MenuRow icon={Search} label="Поиск" onSelect={onSearch} />
          <MenuRow
            icon={chat.muted ? Bell : BellOff}
            label={chat.muted ? "Включить уведомления" : "Выключить уведомления"}
            onSelect={() => mute.mutate()}
          />
          {isGroup ? null : (
            <>
              <MenuRow icon={Phone} label="Позвонить" onSelect={soon("Звонки")} />
              <MenuRow icon={Video} label="Видеозвонок" onSelect={soon("Видеозвонки")} />
            </>
          )}
          <MenuRow icon={CheckSquare} label="Выбрать сообщения" onSelect={onSelectMessages} />
          <MenuRow icon={Brush} label="Оформление чата" onSelect={onAppearance} />
          <MenuRow icon={ImageIcon} label="Фон чата" onSelect={onWallpaper} />
          {isGroup ? (
            <MenuRow icon={Info} label="Информация о группе" onSelect={onOpenInfo} />
          ) : (
            <MenuRow icon={Gift} label="Отправить подарок" onSelect={onSendGift} />
          )}
          <MenuRow icon={Languages} label="Перевод чата" onSelect={soon("Перевод чата")} />

          <DropdownMenu.Separator className={RULE} />

          {/* A complaint about the conversation itself, on the same terms as one about a post. */}
          <MenuRow icon={Flag} label="Пожаловаться" onSelect={onReport} />

          {isGroup ? (
            <MenuRow icon={LogOut} label="Покинуть группу" danger onSelect={() => leave.mutate()} />
          ) : (
            <>
              <MenuRow
                icon={chat.peer_blocked ? ShieldCheck : Ban}
                label={chat.peer_blocked ? "Разблокировать" : "Заблокировать"}
                danger={!chat.peer_blocked}
                onSelect={() => block.mutate()}
              />
              <MenuRow icon={Trash2} label="Удалить чат" danger onSelect={() => remove.mutate()} />
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onSelect,
  danger = false
}: {
  icon: typeof Timer;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`${ROW} ${danger ? "text-[var(--danger)]" : ""}`}
    >
      <Icon size={18} className={danger ? undefined : "text-[var(--muted)]"} />
      {label}
    </DropdownMenu.Item>
  );
}
