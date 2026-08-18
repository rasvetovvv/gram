"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { GiftOffer } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/** Resolved offers keep their outcome visible; a bid should never just disappear. */
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает ответа", color: "var(--stars)" },
  accepted: { label: "Принято", color: "var(--online)" },
  declined: { label: "Отклонено", color: "var(--danger)" },
  cancelled: { label: "Отозвано", color: "var(--dim)" },
  rejected: { label: "Продан другому", color: "var(--dim)" }
};

/**
 * Both sides of the gift market in one place: offers waiting on me, and offers I placed.
 * Without this the buyer had only a notification to go on, and the owner had to open every
 * gift in turn to find out an offer existed.
 */
export function OffersPanel() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const incoming = useQuery({ queryKey: ["gift-offers-incoming"], queryFn: api.incomingGiftOffers });
  const outgoing = useQuery({ queryKey: ["gift-offers-outgoing"], queryFn: api.outgoingGiftOffers });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["gift-offers-incoming"] }),
      queryClient.invalidateQueries({ queryKey: ["gift-offers-outgoing"] }),
      queryClient.invalidateQueries({ queryKey: ["gifts"] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
    ]);

  const resolve = useMutation<unknown, Error, { id: string; action: "accept" | "decline" | "cancel" }>({
    mutationFn: ({ id, action }) =>
      action === "accept"
        ? api.acceptGiftOffer(id)
        : action === "decline"
          ? api.declineGiftOffer(id)
          : api.cancelGiftOffer(id),
    onSuccess: async (_result, variables) => {
      await invalidate();
      notify(
        variables.action === "accept"
          ? "Предложение принято"
          : variables.action === "decline"
            ? "Предложение отклонено"
            : "Предложение отозвано",
        { variant: "success" }
      );
    },
    onError: (error: Error) => notify("Не получилось", { variant: "error", detail: error.message })
  });

  const waiting = incoming.data ?? [];
  const mine = outgoing.data ?? [];
  if (!waiting.length && !mine.length) return null;

  return (
    <section className="mx-3 mb-4 sm:mx-5">
      <h2 className="m-0 mb-2.5 px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--faint)]">
        Предложения
      </h2>
      <div className="overflow-hidden rounded-[20px] bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--line)]">
        {waiting.map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            person={offer.buyer}
            caption="предлагает"
            pending={resolve.isPending}
            actions={
              <>
                <button
                  type="button"
                  className="grid size-9 flex-none place-items-center rounded-full border-0 bg-[var(--online)] text-black disabled:opacity-50"
                  aria-label={`Принять ${offer.amount_stars} ★ от @${offer.buyer.username}`}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: offer.id, action: "accept" })}
                >
                  <Check size={17} />
                </button>
                <button
                  type="button"
                  className="grid size-9 flex-none place-items-center rounded-full border-0 bg-[#2b2024] text-[var(--danger)] disabled:opacity-50"
                  aria-label={`Отклонить предложение @${offer.buyer.username}`}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: offer.id, action: "decline" })}
                >
                  <X size={17} />
                </button>
              </>
            }
          />
        ))}
        {mine.map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            person={offer.seller}
            caption={STATUS[offer.status]?.label ?? offer.status}
            captionColor={STATUS[offer.status]?.color}
            pending={resolve.isPending}
            actions={
              offer.status === "pending" ? (
                <button
                  type="button"
                  className="flex min-h-9 flex-none items-center gap-1.5 rounded-full border-0 bg-[var(--surface-raised)] px-3 text-[13px] font-bold text-[var(--muted)] disabled:opacity-50"
                  aria-label={`Отозвать предложение ${offer.amount_stars} ★`}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: offer.id, action: "cancel" })}
                >
                  <Undo2 size={15} />Отозвать
                </button>
              ) : null
            }
          />
        ))}
      </div>
      {resolve.error ? (
        <p className="mb-0 mt-2 px-1 text-xs text-[var(--danger)]" aria-live="polite">
          {resolve.error.message}
        </p>
      ) : null}
    </section>
  );
}

function OfferRow({
  offer,
  person,
  caption,
  captionColor,
  actions
}: {
  offer: GiftOffer;
  person: GiftOffer["buyer"];
  caption: string;
  captionColor?: string;
  pending: boolean;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-[var(--line)] p-3 last:border-b-0">
      <Link href={`/u/${person.username}`} className="flex-none">
        <UserAvatar src={person.avatar_url} name={person.display_name} size={38} ringColor="transparent" />
      </Link>
      <span className="min-w-0 flex-1">
        <Link href={`/u/${person.username}`} className="block truncate text-sm font-bold hover:underline">
          {person.display_name}
        </Link>
        <span className="block truncate text-xs" style={{ color: captionColor ?? "var(--dim)" }}>
          {caption} · {relativeTime(offer.created_at)}
        </span>
      </span>
      <strong className="flex-none text-sm text-[var(--stars)]">{offer.amount_stars} ★</strong>
      {actions}
    </div>
  );
}
