"use client";

import { Star } from "lucide-react";
import { useUiStore } from "@/store/ui";

/**
 * "Not enough stars" with the way out attached.
 *
 * Every spend on the site can run into an empty wallet, and the honest answer to that is the
 * payment itself rather than a sentence about it: this raises the Telegram Stars sheet over
 * whatever the reader was doing, so nothing they typed is lost.
 */
export function TopUpButton({
  label = "Top up",
  className = "quiet-button w-full"
}: {
  label?: string;
  className?: string;
}) {
  const openTopUp = useUiStore((state) => state.openTopUp);
  return (
    <button type="button" className={className} onClick={openTopUp}>
      <Star size={16} fill="currentColor" className="text-[var(--stars)]" />
      {label}
    </button>
  );
}
