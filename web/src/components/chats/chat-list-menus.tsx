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
            ? "Chat pinned"
            : "Chat unpinned"
          : patch.archived !== undefined
            ? patch.archived
              ? "Chat archived"
              : "Chat unarchived"
            : patch.muted !== undefined
              ? patch.muted
                ? "Notifications off"
                : "Notifications on"
              : patch.marked_unread
                ? "Marked as unread"
                : "Marked as read";
      notify(said, { variant: "success" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });

  const remove = useMutation({
    mutationFn: () => api.deleteChat(chat.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await refresh();
      // Leaving the deleted conversation open would show an empty thread with no way back.
      router.push("/chats");
      notify("Chat deleted", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't delete", { variant: "error", detail: error.message })
  });

  const unread = chat.unread_count > 0 || chat.marked_unread;
  const items = [
    {
      key: "pin",
      label: chat.pinned ? "Unpin" : "Pin",
      icon: chat.pinned ? PinOff : Pin,
      run: () => state.mutate({ pinned: !chat.pinned })
    },
    {
      key: "unread",
      label: unread ? "Mark as read" : "Mark as unread",
      icon: unread ? CheckCheck : MailOpen,
      run: () => state.mutate({ marked_unread: !unread })
    },
    {
      key: "mute",
      label: chat.muted ? "Turn on notifications" : "Turn off notifications",
      icon: chat.muted ? Bell : BellOff,
      run: () => state.mutate({ muted: !chat.muted })
    },
    {
      key: "archive",
      label: chat.archived ? "Unarchive" : "Archive",
      icon: chat.archived ? ArchiveRestore : Archive,
      run: () => state.mutate({ archived: !chat.archived })
    },
    {
      key: "delete",
      label: "Delete",
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
        title="Delete chat?"
        description={`The conversation with ${chat.title ?? chat.participant?.display_name ?? "this chat"} will disappear from your list. It will stay on the other person's side.`}
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        error={remove.error?.message}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

/**
 * The list header's overflow menu: Saved messages, mark-everything-read, and the Telegram import
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
      notify("All chats marked as read", { variant: "success" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition active:bg-white/10"
          aria-label="Menu"
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
            Saved messages
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => readAll.mutate()}>
            <CheckCheck size={18} className="text-[var(--muted)]" />
            Mark all as read
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={ITEM}
            onSelect={() =>
              notify("Import from Telegram", {
                variant: "info",
                detail: "Coming in the next update"
              })
            }
          >
            <Download size={18} className="text-[var(--muted)]" />
            Import from Telegram
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
