"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Lock, RefreshCw, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { Chat } from "@/lib/types";
import { useToast } from "../ui/toast";

/** The link a public group is entered through, built from wherever the app is served. */
function inviteLink(code: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/join/${code}`;
}

/**
 * Who may walk into a group.
 *
 * Two kinds, as the reference has them: a closed group its owner invites into, and a public one
 * that anybody holding the link may join. Closing a group destroys its link rather than parking
 * it, so this says as much before the switch is thrown.
 */
export function GroupAccessBlock({ chat }: { chat: Chat }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chats"] }),
      queryClient.invalidateQueries({ queryKey: ["chat-info", chat.id] }),
      queryClient.invalidateQueries({ queryKey: ["messages", chat.id] })
    ]);

  const access = useMutation({
    mutationFn: (isPublic: boolean) => api.updateGroupAccess(chat.id, isPublic),
    onSuccess: async (updated) => {
      await refresh();
      notify(updated.is_public ? "Group opened via link" : "Group closed", {
        variant: "success",
        detail: updated.is_public
          ? "You can forward the link to anyone"
          : "The previous link no longer works"
      });
    },
    onError: (error: Error) =>
      notify("Couldn't change access", { variant: "error", detail: error.message })
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateGroupInvite(chat.id),
    onSuccess: async () => {
      await refresh();
      notify("Link updated", { variant: "success", detail: "The old one stopped working" });
    },
    onError: (error: Error) =>
      notify("Couldn't update the link", { variant: "error", detail: error.message })
  });

  async function copy() {
    if (!chat.invite_code) return;
    await navigator.clipboard.writeText(inviteLink(chat.invite_code));
    notify("Link copied", { variant: "success" });
  }

  return (
    <section className="mb-6 px-4">
      <h3 className="m-0 pb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
        Access
      </h3>
      <div className="rounded-[16px] bg-white/[0.06] p-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {chat.is_public ? (
            <Users size={17} className="text-[var(--online)]" />
          ) : (
            <Lock size={17} className="text-[var(--muted)]" />
          )}
          {chat.is_public ? "Public group" : "Private group"}
        </span>
        <span className="mt-0.5 block text-[12px] leading-4 text-[var(--muted)]">
          {chat.is_public
            ? "Anyone with the link can join."
            : "Only the owner can add members."}
        </span>

        {chat.is_public && chat.invite_code ? (
          <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-black/35 px-3 py-2">
            <Link2 size={15} className="flex-none text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {inviteLink(chat.invite_code)}
            </span>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy link"
              className="grid size-8 flex-none place-items-center rounded-full transition hover:bg-white/10"
            >
              <Copy size={15} />
            </button>
          </div>
        ) : null}

        {chat.is_owner ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="quiet-button !min-h-10 flex-1 !px-3 text-[13px]"
              disabled={access.isPending}
              onClick={() => access.mutate(!chat.is_public)}
            >
              {chat.is_public ? "Close group" : "Open via link"}
            </button>
            {chat.is_public ? (
              <button
                type="button"
                className="quiet-button !min-h-10 flex-1 !px-3 text-[13px]"
                disabled={rotate.isPending}
                onClick={() => rotate.mutate()}
              >
                <RefreshCw size={15} />
                Update link
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
