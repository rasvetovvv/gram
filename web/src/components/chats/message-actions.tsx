"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  Flag,
  Forward,
  Languages,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  Users
} from "lucide-react";
import { api } from "@/lib/api";
import type { Message } from "@/lib/types";
import { useToast } from "../ui/toast";
import { ReactionPicker } from "./message-reactions";

const ITEM =
  "flex min-h-10 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[0.9rem] font-medium outline-none focus:bg-[#27272a] data-[highlighted]:bg-[#27272a]";
const PANEL =
  "z-[95] min-w-[218px] rounded-[18px] bg-[#17171d] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.55)]";

type Action = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  danger?: boolean;
  run: () => void;
};

/**
 * Per-message actions, matching the reference's own set: reply, copy, edit,
 * pin, delete for yourself or for everyone. Recall and edit are the author's only; hiding and
 * pinning are available to either side.
 *
 * The same list is offered two ways — a right-click context menu on the bubble, and a "…"
 * button for touch, where there is no right button to click.
 */
export function useMessageActions({
  message,
  chatId,
  onReply,
  onEdit,
  onForward,
  onSelect,
  onReport
}: {
  message: Message;
  chatId: string;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  /** Both open the selection the chat already owns, with this message already picked. */
  onForward: (message: Message) => void;
  onSelect: (message: Message) => void;
  onReport: (message: Message) => void;
}): Action[] {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const soon = (label: string) => () =>
    notify(label, { variant: "info", detail: "Coming in the next update" });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["messages", chatId] }),
      queryClient.invalidateQueries({ queryKey: ["chats"] })
    ]);

  const pin = useMutation({
    mutationFn: () => api.pinMessage(chatId, message.id),
    onSuccess: async (updated) => {
      await refresh();
      notify(updated.pinned ? "Message pinned" : "Message unpinned", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't pin", { variant: "error", detail: error.message })
  });

  const remove = useMutation<unknown, Error, "me" | "all">({
    mutationFn: (scope) => api.deleteMessage(chatId, message.id, scope),
    onSuccess: async (_result, scope) => {
      await refresh();
      notify(scope === "all" ? "Deleted for everyone" : "Deleted for you", { variant: "success" });
    },
    onError: (error) => notify("Couldn't delete", { variant: "error", detail: error.message })
  });

  // Service notices are the system talking, not a message anyone can act on.
  if (message.service) return [];

  /**
   * A gift card is neither forwarded nor edited.
   *
   * The card names one collectible with one serial and one owner: a copy of it in another chat
   * would claim a second holder, and rewriting its text would misstate what was given.
   */
  const isGift = Boolean(message.gift);

  return [
    { key: "reply", label: "Reply", icon: Reply, run: () => onReply(message) },
    {
      key: "copy",
      label: "Copy",
      icon: Copy,
      run: () =>
        navigator.clipboard
          .writeText(message.content)
          .then(() => notify("Text copied", { variant: "success" }))
          .catch(() => notify("Couldn't copy", { variant: "error" }))
    },
    { key: "translate", label: "Translate", icon: Languages, run: soon("Message translation") },
    {
      key: "pin",
      label: message.pinned ? "Unpin" : "Pin",
      icon: message.pinned ? PinOff : Pin,
      run: () => pin.mutate()
    },
    ...(isGift
      ? []
      : [{ key: "forward", label: "Forward", icon: Forward, run: () => onForward(message) }]),
    { key: "select", label: "Select", icon: CheckCircle2, run: () => onSelect(message) },
    ...(message.is_mine
      ? isGift
        ? []
        : [{ key: "edit", label: "Edit", icon: Pencil, run: () => onEdit(message) }]
      : [
          {
            key: "report",
            label: "Report",
            icon: Flag,
            run: () => onReport(message)
          }
        ]),
    { key: "hide", label: "Delete for me", icon: Trash2, danger: true, run: () => remove.mutate("me") },
    ...(message.is_mine
      ? [
          {
            key: "recall",
            label: "Delete for everyone",
            icon: Users,
            danger: true,
            run: () => remove.mutate("all")
          }
        ]
      : [])
  ];
}

/** Right-click (and long-press, where the browser maps it to `contextmenu`) on a bubble. */
export function MessageContextMenu({
  actions,
  onReact,
  children,
  disabled = false
}: {
  actions: Action[];
  onReact?: (emoji: string) => void;
  children: React.ReactNode;
  /** Selection mode owns the tap, so the long-press menu steps aside while it is on. */
  disabled?: boolean;
}) {
  if (disabled || !actions.length) return <>{children}</>;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        {/* The reaction row is not a menu item: it must not close on arrow keys or take focus. */}
        <ContextMenu.Content className={`${PANEL} border-0 bg-transparent p-0 shadow-none`} collisionPadding={12}>
          {onReact ? <ReactionPicker onPick={onReact} /> : null}
          <div className={PANEL}>
          {actions.map((action) => (
            <ContextMenu.Item
              key={action.key}
              className={`${ITEM} ${action.danger ? "text-[var(--danger)]" : ""}`}
              onSelect={action.run}
            >
              <action.icon size={17} className={action.danger ? undefined : "text-[var(--muted)]"} />
              {action.label}
            </ContextMenu.Item>
          ))}
          </div>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Touch-friendly trigger for the same list. */
export function MessageActionsButton({
  actions,
  alignEnd,
  onReact
}: {
  actions: Action[];
  alignEnd: boolean;
  onReact?: (emoji: string) => void;
}) {
  if (!actions.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="icon-button !size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          aria-label="Message actions"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={alignEnd ? "end" : "start"}
          sideOffset={6}
          collisionPadding={12}
          className="z-[95] border-0 bg-transparent p-0 shadow-none"
        >
          {onReact ? <ReactionPicker onPick={onReact} /> : null}
          <div className={PANEL}>
          {actions.map((action) => (
            <DropdownMenu.Item
              key={action.key}
              className={`${ITEM} ${action.danger ? "text-[var(--danger)]" : ""}`}
              onSelect={action.run}
            >
              <action.icon size={17} className={action.danger ? undefined : "text-[var(--muted)]"} />
              {action.label}
            </DropdownMenu.Item>
          ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
