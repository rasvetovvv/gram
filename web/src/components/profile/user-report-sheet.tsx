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
      notify("Report submitted", {
        variant: "success",
        detail: `We'll take a look at @${profile.username}`
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't submit", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={`Account @${profile.username}`}
      note="They won't know who reported them. Blocking is a separate action in the same menu."
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}