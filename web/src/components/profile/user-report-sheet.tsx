"use client";

import { useMutation } from "@tanstack/react-query";
import { api, type PostReportReason } from "@/lib/api";
import type { User } from "@/lib/types";
import { ReportSheet } from "../ui/report-sheet";
import { useToast } from "../ui/toast";

/** A complaint about an account, on the same terms as one about a post. */
export function UserReportSheet({
  profile,
  open,
  onOpenChange
}: {
  profile: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notify } = useToast();
  const send = useMutation({
    mutationFn: ({ reason, comment }: { reason: PostReportReason; comment: string }) =>
      api.reportUser(profile.username, reason, comment),
    onSuccess: () => {
      notify("Жалоба отправлена", {
        variant: "success",
        detail: `Мы посмотрим на @${profile.username}`
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Не удалось отправить", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={`Аккаунт @${profile.username}`}
      note="Он не узнает, кто пожаловался. Блокировка — отдельное действие в том же меню."
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}
