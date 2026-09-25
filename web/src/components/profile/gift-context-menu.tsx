"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Crown,
  Eye,
  EyeOff,
  Gem,
  HandCoins,
  Pin,
  PinOff,
  Sparkles,
  Tag
} from "lucide-react";
import { api } from "@/lib/api";
import type { Gift } from "@/lib/types";
import { useUiStore } from "@/store/ui";
import { useToast } from "../ui/toast";

const ITEM =
  "flex min-h-10 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-sm outline-none focus:bg-[#27272a] data-[disabled]:opacity-50";

/**
 * One verb about one gift: run it, refresh what it touched, and turn the server's 402 into an
 * invitation rather than an error nobody can act on.
 */
function useGiftAction(
  run: () => Promise<unknown>,
  done: string,
  refresh: () => Promise<unknown>
) {
  const { notify } = useToast();
  const openPremium = useUiStore((state) => state.openPremium);
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await refresh();
      notify(done, { variant: "success" });
    },
    onError: (error: Error) => {
      const premium = error.message.includes("Premium");
      notify(premium ? "This is a Premium feature" : "Didn't work", {
        variant: premium ? "info" : "error",
        detail: error.message
      });
      if (premium) openPremium();
    }
  });
}

/**
 * Everything an owner can do with one gift, on a right click.
 *
 * All of it was already possible — inside the sheet the tile opens — which meant five verbs
 * hidden two taps deep. This is the same set where the item already is, and it only wraps the
 * tile for its owner: a visitor's right click stays the browser's own.
 */
export function GiftContextMenu({
  gift,
  owned,
  username,
  children
}: {
  gift: Gift;
  owned: boolean;
  username?: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["gifts"] }),
      queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["profile", username] })
    ]);

  const pin = useGiftAction(
    () => api.pinGift(gift.id, !gift.is_pinned),
    gift.is_pinned ? "Unpinned from your collection" : "Pinned to your collection",
    refresh
  );
  const hide = useGiftAction(
    () => api.setGiftVisibility(gift.id, !gift.hidden_in_profile),
    gift.hidden_in_profile ? "Visible in your profile again" : "Hidden from your profile",
    refresh
  );
  const offers = useGiftAction(
    () => api.setGiftOffersDisabled(gift.id, !gift.offers_disabled),
    gift.offers_disabled ? "Offers are open again" : "No more price offers",
    refresh
  );
  const cover = useGiftAction(
    () => api.setGiftShowcase(gift.id, "featured"),
    "Gift is featured in the header",
    refresh
  );
  const beside = useGiftAction(
    () => api.setGiftShowcase(gift.id, "name"),
    "Gift sits next to your name",
    refresh
  );
  const unlist = useGiftAction(() => api.setGiftListing(gift.id, null), "Removed from sale", refresh);

  if (!owned) return <>{children}</>;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[95] min-w-56 rounded-[18px] bg-[#17171d] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.55)]">
          <ContextMenu.Label className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#52525c]">
            {gift.name} #{gift.serial_number}
          </ContextMenu.Label>
          <ContextMenu.Item className={ITEM} onSelect={() => pin.mutate()}>
            {gift.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
            {gift.is_pinned ? "Unpin from collection" : "Pin to collection"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={ITEM}
            disabled={gift.hidden_in_profile}
            onSelect={() => cover.mutate()}
          >
            <Sparkles size={16} />
            Feature in header
          </ContextMenu.Item>
          <ContextMenu.Item
            className={ITEM}
            disabled={gift.hidden_in_profile}
            onSelect={() => beside.mutate()}
          >
            <Gem size={16} />
            Show next to name
            <Crown size={13} className="ml-auto text-[var(--stars)]" />
          </ContextMenu.Item>
          <ContextMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
          <ContextMenu.Item className={ITEM} onSelect={() => hide.mutate()}>
            {gift.hidden_in_profile ? <Eye size={16} /> : <EyeOff size={16} />}
            {gift.hidden_in_profile ? "Show in profile" : "Hide gift"}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => offers.mutate()}>
            {gift.offers_disabled ? <HandCoins size={16} /> : <Ban size={16} />}
            {gift.offers_disabled ? "Allow offers" : "Don't offer me a price"}
          </ContextMenu.Item>
          {gift.is_listed ? (
            <ContextMenu.Item className={ITEM} onSelect={() => unlist.mutate()}>
              <Tag size={16} />
              Remove from sale
            </ContextMenu.Item>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
