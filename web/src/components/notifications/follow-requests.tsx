"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UserRoundPlus, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import { plural, relativeTime } from "@/lib/utils";
import { AdminMark } from "../admin-mark";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";

/**
 * Who is waiting to be let into a closed account.
 *
 * It sits at the top of the notifications, because that is where a closed account is told
 * about them and because a request expires by being answered, not by being read. Nothing is
 * drawn at all while the list is empty — an open account never sees this block.
 */
export function FollowRequests() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const requests = useQuery({ queryKey: ["follow-requests"], queryFn: api.followRequests });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["follow-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["profile"] })
    ]);

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptFollowRequest(id),
    onSuccess: async (_result, id) => {
      const name = requests.data?.find((item) => item.id === id)?.user.display_name;
      await refresh();
      notify(name ? `${name} теперь подписан(а) на вас` : "Заявка принята", { variant: "success" });
    },
    onError: (error: Error) => notify("Не удалось принять", { variant: "error", detail: error.message })
  });
  const decline = useMutation({
    mutationFn: (id: string) => api.declineFollowRequest(id),
    onSuccess: async () => {
      await refresh();
      notify("Заявка отклонена", { variant: "success", detail: "Автор об этом не узнает." });
    },
    onError: (error: Error) =>
      notify("Не удалось отклонить", { variant: "error", detail: error.message })
  });

  const items = requests.data ?? [];
  if (!items.length) return null;

  return (
    <section className="surface mx-2 mb-2 px-3 py-3 sm:mx-3" aria-label="Заявки на подписку">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold">
        <UserRoundPlus size={16} className="text-[var(--primary-strong)]" />
        Заявки на подписку
        <span className="text-[13px] font-semibold text-[var(--muted)]">
          {items.length} {plural(items.length, "человек", "человека", "человек")}
        </span>
      </h2>
      <div className="mt-2 grid gap-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-[14px] px-1 py-1.5">
            <Link href={`/u/${item.user.username}`} className="shrink-0">
              <UserAvatar
                src={item.user.avatar_url}
                name={item.user.display_name}
                online={item.user.is_online}
                size={40}
                ringColor="var(--surface)"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1">
                {item.user.is_admin ? <AdminMark size={13} /> : null}
                <Link
                  href={`/u/${item.user.username}`}
                  className="truncate text-[15px] font-bold hover:underline"
                  style={{ color: nameColor(item.user.profile_color) }}
                >
                  {item.user.display_name}
                </Link>
                {item.user.verified ? <VerifiedMark size={14} /> : null}
              </span>
              <span className="block truncate text-[13px] text-[var(--muted)]">
                @{item.user.username} · {relativeTime(item.created_at)}
              </span>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                className="signal-button !h-9 !px-3 !text-[13px]"
                disabled={accept.isPending || decline.isPending}
                onClick={() => accept.mutate(item.id)}
              >
                <Check size={15} />
                Принять
              </button>
              <button
                type="button"
                className="icon-button !size-9"
                aria-label={`Отклонить заявку ${item.user.display_name}`}
                disabled={accept.isPending || decline.isPending}
                onClick={() => decline.mutate(item.id)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
