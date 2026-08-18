"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { BottomSheet } from "../ui/bottom-sheet";
import { GiftGallery } from "./gift-gallery";

/**
 * The gift collection as a sheet over the current page. Mounted once in the shell so any
 * entry point — sidebar, profile, empty state — raises it without a route change.
 */
export function GiftsSheet() {
  const open = useUiStore((state) => state.giftsOpen);
  const recipient = useUiStore((state) => state.giftsRecipient);
  const closeGifts = useUiStore((state) => state.closeGifts);
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: open });

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeGifts();
      }}
      title="Коллекционные подарки"
      description="Каталог, ваша коллекция и предложения по подаркам."
      headerRight={
        <Link
          href="/stars"
          onClick={closeGifts}
          className="flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--surface-raised)] px-3 text-sm font-extrabold text-[var(--stars)]"
        >
          <Star size={15} fill="currentColor" />
          {me.data?.stars_balance ?? 0}
        </Link>
      }
    >
      {open ? <GiftGallery recipient={recipient ?? undefined} inSheet /> : null}
    </BottomSheet>
  );
}
