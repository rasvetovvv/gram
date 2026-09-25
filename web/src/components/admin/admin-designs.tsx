"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AdminDesign } from "@/lib/types";
import { useToast } from "../ui/toast";
import { CHIP, FIELD, QUIET } from "./admin-user-sheet";

/**
 * Supply and price, per design.
 *
 * `remaining` is the number the storefront promises, so the edition ceiling is the one field
 * that cannot be lowered past what has already been minted — the serials in people's
 * collections would start claiming to be out of a run smaller than themselves.
 */
function DesignRow({ design }: { design: AdminDesign }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [edition, setEdition] = useState(String(design.edition_size));
  const [price, setPrice] = useState(String(design.price_stars));
  const [reason, setReason] = useState("");

  const save = async (patch: Parameters<typeof api.adminUpdateDesign>[1], label: string) => {
    try {
      await api.adminUpdateDesign(design.slug, { ...patch, reason: reason || undefined });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-designs"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
      ]);
      notify(label, { variant: "success" });
    } catch (error) {
      notify("Something went wrong", { variant: "error", detail: (error as Error).message });
    }
  };

  const editionChanged = Number.parseInt(edition, 10) !== design.edition_size;
  const priceChanged = Number.parseInt(price, 10) !== design.price_stars;
  return (
    <li className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <strong className="text-[15px] font-bold">{design.name}</strong>
        <span className="text-[13px] text-[var(--dim)]">
          {design.slug} · minted {design.minted} of {design.edition_size} · remaining{" "}
          <span className={design.remaining ? "text-[var(--online)]" : "text-[var(--danger)]"}>
            {design.remaining}
          </span>
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
        <input
          value={edition}
          onChange={(event) => setEdition(event.target.value)}
          inputMode="numeric"
          aria-label="Edition size"
          placeholder="edition size"
          className={FIELD}
        />
        <input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          inputMode="numeric"
          aria-label="Price in stars"
          placeholder="price ★"
          className={FIELD}
        />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="reason"
          className={FIELD}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!editionChanged && !priceChanged}
          onClick={() =>
            save(
              {
                ...(editionChanged ? { edition_size: Number.parseInt(edition, 10) } : {}),
                ...(priceChanged ? { price_stars: Number.parseInt(price, 10) } : {})
              },
              "Design updated"
            )
          }
          className={QUIET}
        >
          <Check size={13} />
          Save
        </button>
        <button
          type="button"
          onClick={() =>
            save({ available: !design.available }, design.available ? "Taken off sale" : "On sale")
          }
          className={design.available ? `${CHIP} bg-[var(--online)] text-black` : QUIET}
        >
          {design.available ? "On sale" : "Not for sale"}
        </button>
        <button
          type="button"
          onClick={() => save({ on_market: !design.on_market }, "Storefront updated")}
          className={design.on_market ? `${CHIP} bg-[var(--primary)] text-white` : QUIET}
        >
          {design.on_market ? "On storefront" : "Off storefront"}
        </button>
        <button
          type="button"
          onClick={() => save({ limited: !design.limited }, "Limit updated")}
          className={design.limited ? `${CHIP} bg-[var(--stars)] text-black` : QUIET}
        >
          {design.limited ? "Limited" : "Standard"}
        </button>
      </div>
    </li>
  );
}

export function AdminDesignsPanel() {
  const [query, setQuery] = useState("");
  const designs = useQuery({
    queryKey: ["admin-designs", query],
    queryFn: () => api.adminDesigns(query.trim() || undefined)
  });
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3">
        <Search size={16} className="shrink-0 text-[var(--muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Design name or slug"
          aria-label="Search designs"
          className={FIELD}
        />
      </div>
      {designs.data?.length ? (
        <ul className="m-0 list-none p-0">
          {designs.data.map((design) => (
            <DesignRow key={design.slug} design={design} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">Nothing found</p>
      )}
    </div>
  );
}