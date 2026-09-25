"use client";

import { AtSign, Phone } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { UsernameMarket } from "@/components/market/username-market";
import { NumberMarket } from "@/components/market/number-market";

type Surface = "usernames" | "numbers";

/**
 * The collectibles market: usernames and anonymous +888 numbers, switched at the top so both
 * live under one route without either losing its own hero, stats and shelves.
 */
export default function MarketPage() {
  const [surface, setSurface] = useState<Surface>("usernames");
  const { t } = useLocale();
  return (
    <>
      <div className="px-3 pt-3 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label={t("Market")}>
          <button
            role="tab"
            aria-selected={surface === "usernames"}
            data-active={surface === "usernames"}
            onClick={() => setSurface("usernames")}
            className="flex items-center justify-center gap-2"
          >
            <AtSign size={16} />
            {t("Usernames")}
          </button>
          <button
            role="tab"
            aria-selected={surface === "numbers"}
            data-active={surface === "numbers"}
            onClick={() => setSurface("numbers")}
            className="flex items-center justify-center gap-2"
          >
            <Phone size={16} />
            {t("Numbers")}
          </button>
        </div>
      </div>
      <div key={surface} className="panel-enter">
        {surface === "usernames" ? <UsernameMarket /> : <NumberMarket />}
      </div>
    </>
  );
}
