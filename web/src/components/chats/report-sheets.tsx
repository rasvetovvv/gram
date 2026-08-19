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
      notify("Жалоба отправлена", {
        variant: "success",
        detail: messageId ? "Мы посмотрим на это сообщение." : "Мы посмотрим на эту переписку."
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
      subject={subject}
      note={
        messageId
          ? "Автор не узнает, кто пожаловался. Сообщение останется в чате до решения."
          : "Участники не узнают, кто пожаловался. Чтобы перестать получать сообщения, заблокируйте собеседника."
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
      notify("Жалоба отправлена", { variant: "success", detail: `Мы посмотрим на «${title}»` });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Не удалось отправить", { variant: "error", detail: error.message })
  });

  return (
    <ReportSheet
      open={open}
      onOpenChange={onOpenChange}
      subject={`Сообщество @${slug}`}
      note="Владелец не узнает, кто пожаловался. Подписка на сообщество — отдельное действие."
      pending={send.isPending}
      onSend={(reason, comment) => send.mutate({ reason, comment })}
    />
  );
}
