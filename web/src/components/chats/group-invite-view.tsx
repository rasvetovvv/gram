"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Link2, Lock, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/**
 * A group's invite link, opened.
 *
 * The link is the whole credential, so the page shows what is behind it before anybody walks in:
 * the group's name, how many people are already there and who owns it. A link that has been
 * rotated or a group that has since been closed says so plainly instead of failing blank.
 */
export function GroupInviteView({ code }: { code: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const preview = useQuery({
    queryKey: ["group-invite", code],
    queryFn: () => api.groupInvite(code),
    retry: false
  });

  const join = useMutation({
    mutationFn: () => api.joinGroupByInvite(code),
    onSuccess: (chat) => {
      notify(`You're in the group “${chat.title ?? ""}”`, { variant: "success" });
      router.replace(`/chats?chat=${chat.id}`);
    },
    onError: (error: Error) =>
      notify("Couldn't join", { variant: "error", detail: error.message })
  });

  return (
    <>
      <div className="mobile-topbar">
        <Link href="/chats" className="icon-button" aria-label="To chats">
          <ArrowLeft size={21} />
        </Link>
        <span className="wordmark">INVITE</span>
        <span className="size-11" />
      </div>

      <section className="grid place-items-center px-4 py-10">
        {preview.isLoading ? (
          <div className="skeleton h-40 w-full max-w-[26rem] rounded-[24px]" />
        ) : preview.isError ? (
          <div className="surface w-full max-w-[26rem] p-6 text-center">
            <Lock size={30} className="mx-auto text-[var(--muted)]" />
            <h1 className="mt-4 text-xl font-extrabold">This link doesn&apos;t work</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {preview.error.message}
            </p>
            <Link href="/chats" className="quiet-button mt-4">
              Back to chats
            </Link>
          </div>
        ) : preview.data ? (
          <div className="surface w-full max-w-[26rem] p-6 text-center">
            <span className="mx-auto block w-fit">
              <UserAvatar
                src={preview.data.avatar_url}
                name={preview.data.title}
                size={84}
                radius="26px"
              />
            </span>
            <h1 className="mt-4 text-2xl font-extrabold leading-tight">{preview.data.title}</h1>
            <p className="mt-1.5 flex items-center justify-center gap-1.5 text-sm text-[var(--muted)]">
              <Users size={15} />
              {preview.data.members_count} members
            </p>
            {preview.data.owner ? (
              <p className="mt-1 text-[13px] text-[var(--dim)]">
                Owner @{preview.data.owner.username}
              </p>
            ) : null}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-[var(--dim)]">
              <Link2 size={13} />
              Join via link — public group
            </p>
            {preview.data.is_member ? (
              <Link
                href={`/chats?chat=${preview.data.chat_id}`}
                className="signal-button mt-5 w-full"
              >
                Open group
              </Link>
            ) : (
              <button
                type="button"
                className="signal-button mt-5 w-full"
                disabled={join.isPending}
                onClick={() => join.mutate()}
              >
                {join.isPending ? "Joining…" : "Join"}
              </button>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}
