"use client";

import { useMutation } from "@tanstack/react-query";
import { api, type PostReportReason } from "@/lib/api";
import type { Post } from "@/lib/types";
import { ReportSheet } from "../ui/report-sheet";
import { useToast } from "../ui/toast";

/**
 * A complaint about someone else's post.
 *
 * The reason is stored with the post, not answered by a toast and forgotten: the sheet says
 * "Report sent" because a row was written, and sending it twice replaces the reason
 * rather than counting twice.
 */
export function PostReportSheet({
  post,
  open,
  onOpenChange
}: {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notify } = useToast();
  const send = useMutation({
    mutationFn: ({ reason, comment }: { reason: PostReportReason; comment: string }) =>
      api.reportPost(post.id, reason, comment),
    onSuccess: () => {
      notify("Report sent", { variant: "success", detail: "We'll take a look at this post." });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't send", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={`Post by @${post.author.username}`}
      note="The author won't know who reported. The post stays in the feed until a decision is made."
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}
