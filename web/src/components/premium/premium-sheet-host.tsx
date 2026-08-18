"use client";

import { useUiStore } from "@/store/ui";
import { PremiumSheet } from "./premium-sheet";

/**
 * Premium mounted once in the shell. Entry points flip store state instead of navigating,
 * so the page underneath stays put and the sheet visibly slides over it.
 */
export function PremiumSheetHost() {
  const open = useUiStore((state) => state.premiumOpen);
  const closePremium = useUiStore((state) => state.closePremium);
  return (
    <PremiumSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closePremium();
      }}
    />
  );
}
