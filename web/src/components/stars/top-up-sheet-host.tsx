"use client";

import { useUiStore } from "@/store/ui";
import { TopUpSheet } from "./top-up-sheet";

/**
 * The top-up sheet, mounted once in the shell.
 *
 * Stars run out inside other flows — buying a gift, bidding on a handle, taking Premium — and each
 * of those needs to be able to raise the payment without navigating away and losing what the
 * reader was doing.
 */
export function TopUpSheetHost() {
  const open = useUiStore((state) => state.topUpOpen);
  const closeTopUp = useUiStore((state) => state.closeTopUp);
  return (
    <TopUpSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTopUp();
      }}
    />
  );
}
