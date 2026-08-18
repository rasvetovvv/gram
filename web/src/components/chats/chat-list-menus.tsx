"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Bookmark,
  CheckCheck,
  Download,
  MailOpen,
  MoreVertical,
  Pin,
  PinOff,
  Trash2
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Chat } from "@/lib/types";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useToast } from "../ui/toast";

/**
 * Menu surface shared by the chat row's context menu and the list header's overflow menu,
 * measured off the reference: 16px radius, hairline border, 6px vertical padding, and 44px
 * rows at 16px with a 12px gap.
 */
const PANEL =
  "z-[95] min-w-[230px] max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--sheet-line)] py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]";
const PANEL_STYLE = { background: "var(--menu)", backdropFilter: "var(--menu-blur)" } as const;
const ITEM =
  "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 text-[16px] outline-none focus:bg-white/[0.06] data-[highlighted]:bg-white/[0.06]";

/**
 * Right-click (or long-press) on a conversation, exactly the reference's four entries.
 *
 * Every action is personal — pinning, archiving and deleting change only my own list, which
 * is why deletion can be confirmed without warning about the other person's history.
 */
export function ChatRowMenu({ chat, children }: { chat: Chat; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { notify } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chats"] }),
      queryClient.invalidateQueries({ queryKey: ["chat-folders"] })
    ]);

  const state = useMutation({
    mutationFn: (patch: {
      pinned?: boolean;
      archived?: boolean;
      marked_unread?: boolean;
      muted?: boolean;
    }) => api.updateChatState(chat.id, patch),
    onSuccess: async (_chat, patch) => {
      await refresh();
      const said =
        patch.pinned !== undefined
          ? patch.pinned
            ? "Чат закреплён"
            : "Чат откреплён"
          : patch.archived !== undefined
            ? patch.archived
              ? "Чат в архиве"
              : "Чат из архива"
            : patch.muted !== undefined
              ? patch.muted
                ? "Уведомления выключены"
                : "Уведомления включены"
              : patch.marked_unread
                ? "Помечено непрочитанным"
                : "Помечено прочитанным";
      notify(said, { variant: "success" });
    },
    onError: (error: Error) => notify("Не получилось", { variant: "error", detail: error.message })
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await refresh();
      // Leaving the deleted conversation open would show an empty thread with no way back.
      router.push("/chats");
      notify("Чат удалён", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить", { variant: "error", detail: error.message })
  });

  const unread = chat.unread_count > 0 || chat.marked_unread;
  const items = [
    {
      key: "pin",
      label: chat.pinned ? "Открепить" : "Закрепить",
      icon: chat.pinned ? PinOff : Pin,
      run: () => state.mutate({ pinned: !chat.pinned })
    },
    {
      key: "unread",
      label: unread ? "Пометить прочитанным" : "Пометить непрочитанным",
      icon: unread ? CheckCheck : MailOpen,
      run: () => state.mutate({ marked_unread: !unread })
    },
    {
      key: "mute",
      label: chat.muted ? "Включить уведомления" : "Выключить уведомления",
      icon: chat.muted ? Bell : BellOff,
      run: () => state.mutate({ muted: !chat.muted })
    },
    {
      key: "archive",
      label: chat.archived ? "Из архива" : "В архив",
      icon: chat.archived ? ArchiveRestore : Archive,
      run: () => state.mutate({ archived: !chat.archived })
    },
    {
      key: "delete",
      label: "Удалить",
      icon: Trash2,
      danger: true,
      run: () => setConfirmDelete(true)
    }
  ];

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={PANEL} style={PANEL_STYLE} collisionPadding={10}>
            {items.map((item) => (
              <ContextMenu.Item
                key={item.key}
                onSelect={(event) => {
                  // Deletion hands off to a dialog, so the menu must not close first.
                  if (item.danger) event.preventDefault();
                  item.run();
                }}
                className={`${ITEM} ${item.danger ? "text-[var(--danger)]" : ""}`}
              >
                <item.icon size={18} className={item.danger ? undefined : "text-[var(--muted)]"} />
                {item.label}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить чат?"
        description={`Переписка с ${chat.title ?? chat.participant?.display_name ?? "этим чатом"} исчезнет из вашего списка. У собеседника она останется.`}
        confirmLabel={remove.isPending ? "Удаляем…" : "Удалить"}
        error={remove.error?.message}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

/**
 * The list header's overflow menu: Избранное, mark-everything-read, and the Telegram import
 * the reference offers. Import has no backend here, so it says so rather than pretending.
 */
export function ChatListMenu({ onOpenSaved }: { onOpenSaved: () => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const readAll = useMutation({
    mutationFn: () => api.readAllChats(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-folders"] })
      ]);
      notify("Все чаты прочитаны", { variant: "success" });
    },
    onError: (error: Error) => notify("Не получилось", { variant: "error", detail: error.message })
  });

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition active:bg-white/10"
          aria-label="Меню"
        >
          <MoreVertical size={22} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={10}
          className={`${PANEL} w-60`}
          style={PANEL_STYLE}
        >
          <DropdownMenu.Item className={ITEM} onSelect={onOpenSaved}>
            <Bookmark size={18} className="text-[var(--muted)]" />
            Избранное
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => readAll.mutate()}>
            <CheckCheck size={18} className="text-[var(--muted)]" />
            Отметить все прочитанными
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={ITEM}
            onSelect={() =>
              notify("Импорт из Telegram", {
                variant: "info",
                detail: "Появится в следующем обновлении"
              })
            }
          >
            <Download size={18} className="text-[var(--muted)]" />
            Импорт из Telegram
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
