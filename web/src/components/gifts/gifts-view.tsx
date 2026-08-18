"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUiStore } from "@/store/ui";

/**
 * `/gifts` is a shareable link to a sheet, not a page of its own. It raises the sheet and
 * swaps the URL for the feed, so there is always a real surface behind the popup and
 * closing it lands somewhere instead of on an empty route.
 */
export function GiftsView({ recipient }: { recipient?: string }) {
  const router = useRouter();
  const openGifts = useUiStore((state) => state.openGifts);
  useEffect(() => {
    openGifts(recipient);
    router.replace("/");
  }, [openGifts, recipient, router]);
  return null;
}
