"use client";

import { useMutation } from "@tanstack/react-query";
import { api, type PostReportReason } from "@/lib/api";
import { ReportSheet } from "../ui/report-sheet";
import { useToast } from "../ui/toast";

/**
 * A complaint about a conversation, or about one message in it.
 *
 * Same sheet and same terms as a complaint about a post or an account: the reason is stored
 * once per person per target, and nobody is told who sent it.
 */
export function ChatReportSheet({
  chatId,
  messageId,
  subject,
  open,
  onOpenChange
}: {
  chatId: string;
  /** Present when the complaint is about one message rather than the whole conversation. */
  messageId?: string;
  subject: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notify } = useToast();
  const send = useMutation({
    mutationFn: ({ reason, comment }: { reason: PostReportReason; comment: string }) =>
      messageId
        ? api.reportMessage(chatId, messageId, reason, comment)
        : api.reportChat(chatId, reason, comment),
    onSuccess: () => {
      notify("Report sent", {
        variant: "success",
        detail: messageId ? "We'll take a look at this message." : "We'll take a look at this conversation."
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't send", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={subject}
      note={
        messageId
          ? "The author won't know who reported it. The message stays in the chat until a decision is made."
          : "Participants won't know who reported it. To stop receiving messages, block the other person."
      }
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}

/** A complaint about a community, named by its handle because that is its address. */
export function CommunityReportSheet({
  slug,
  title,
  open,
  onOpenChange
}: {
  slug: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notify } = useToast();
  const send = useMutation({
    mutationFn: ({ reason, comment }: { reason: PostReportReason; comment: string }) =>
      api.reportCommunity(slug, reason, comment),
    onSuccess: () => {
      notify("Report sent", { variant: "success", detail: `We'll take a look at "${title}"` });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't send", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={`Community @${slug}`}
      note="The owner won't know who reported it. Following the community is a separate action."
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}
