"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useUiStore } from "@/store/ui";

/**
 * Opens the collection when a shared `/gifts` link lands on the feed.
 *
 * The query is cleared as soon as it is read, so closing the sheet does not leave a url that
 * reopens it on the next reload.
 */
export function GiftsDeepLink() {
  const params = useSearchParams();
  const router = useRouter();
  const openGifts = useUiStore((state) => state.openGifts);
  const wanted = params.get("gifts");
  const recipient = params.get("to");

  useEffect(() => {
    if (!wanted) return;
    openGifts(recipient ?? undefined);
    router.replace("/");
  }, [wanted, recipient, openGifts, router]);

  return null;
}
