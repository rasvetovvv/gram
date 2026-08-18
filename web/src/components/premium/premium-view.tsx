"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUiStore } from "@/store/ui";

/**
 * `/premium` is a shareable link to a sheet, not a page of its own. It raises the sheet and
 * swaps the URL for the feed, so there is always a real surface behind the popup and
 * closing it lands somewhere instead of on an empty route.
 */
export function PremiumView() {
  const router = useRouter();
  const openPremium = useUiStore((state) => state.openPremium);
  useEffect(() => {
    openPremium();
    router.replace("/");
  }, [openPremium, router]);
  return null;
}
