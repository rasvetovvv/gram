"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { api, type ShowcaseSlot } from "@/lib/api";
import type { Gift, User } from "@/lib/types";
import { useUiStore } from "@/store/ui";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import { GiftImage, giftArtProps } from "../gifts/gift-image";

/**
 * Which gift sits where on the cover.
 *
 * Four places, in a fixed order: the first is anyone's to arrange, the rest come with Premium.
 * Every filled slot can be emptied whatever the account pays, so a lapsed subscription leaves
 * a cover its owner can still tidy.
 */
export const COVER_SLOTS: ShowcaseSlot[] = ["featured", "cover2", "cover3", "cover4"];

const SLOT_TITLES: Record<string, string> = {
  featured: "Первый подарок",
  cover2: "Второй подарок",
  cover3: "Третий подарок",
  cover4: "Четвёртый подарок"
};

export function CoverGiftsSheet({
  profile,
  gifts,
  open,
  onOpenChange
}: {
  profile: User;
  gifts: Gift[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const openPremium = useUiStore((state) => state.openPremium);
  const [picking, setPicking] = useState<ShowcaseSlot | null>(null);
  const owned = useQuery({
    queryKey: ["gifts", profile.username],
    queryFn: () => api.gifts(profile.username),
    enabled: open
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", profile.username] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["gifts", profile.username] })
    ]);

  const place = useMutation({
    mutationFn: ({ id, slot }: { id: string; slot: ShowcaseSlot }) => api.setGiftShowcase(id, slot),
    onSuccess: async () => {
      setPicking(null);
      await refresh();
      notify("Шапка обновлена", { variant: "success" });
    },
    onError: (error: Error) => {
      // 402 is the premium boundary, and the sheet says so rather than reading as a failure.
      const premium = error.message.includes("Premium");
      notify(premium ? "Это возможность Premium" : "Не удалось поставить", {
        variant: premium ? "info" : "error",
        detail: error.message
      });
      if (premium) openPremium();
    }
  });
  const clear = useMutation({
    mutationFn: (slot: ShowcaseSlot) => api.clearShowcaseSlot(slot),
    onSuccess: async () => {
      await refresh();
      notify("Подарок убран из шапки", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось убрать", { variant: "error", detail: error.message })
  });

  const cover = profile.cover_gifts ?? [];
  const isPremium = Boolean(profile.is_premium);
  const filled = new Map(COVER_SLOTS.map((slot, index) => [slot, cover[index]]));
  const pool = (owned.data ?? gifts).filter((gift) => !gift.hidden_in_profile);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPicking(null);
      }}
      title="Подарки в шапке"
      description="До четырёх подарков поверх обложки"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Подарки в шапке</h2>
        <p className="mb-4 mt-1 text-[13px] leading-5 text-[var(--muted)]">
          Первый подарок ставит любой аккаунт. Второй, третий и четвёртый — и подарок рядом с
          именем — входят в Premium.
        </p>

        {picking ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[15px] font-bold">{SLOT_TITLES[picking]}</strong>
              <button type="button" className="quiet-button !h-9" onClick={() => setPicking(null)}>
                Назад
              </button>
            </div>
            {pool.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {pool.map((gift) => (
                  <button
                    key={gift.id}
                    type="button"
                    disabled={place.isPending}
                    onClick={() => place.mutate({ id: gift.id, slot: picking })}
                    className="grid place-items-center gap-1 rounded-[16px] bg-[var(--surface-raised)] p-2 transition hover:brightness-110 active:scale-95 disabled:opacity-60"
                  >
                    <GiftImage {...giftArtProps(gift)} size={56} bare animate="hover" />
                    <span className="w-full truncate text-center text-[11px] text-[var(--muted)]">
                      #{gift.serial_number}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="m-0 rounded-[14px] bg-white/[0.04] p-3 text-[13px] text-[var(--muted)]">
                Скрытые подарки в шапку не ставятся — сначала верните их в коллекцию.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            {COVER_SLOTS.map((slot, index) => {
              const gift = filled.get(slot);
              const locked = index > 0 && !isPremium;
              return (
                <div
                  key={slot}
                  className="flex items-center gap-3 rounded-[16px] bg-[var(--surface-raised)] p-2.5"
                >
                  <span className="grid size-12 flex-none place-items-center rounded-[14px] bg-black/25">
                    {gift ? (
                      <GiftImage {...giftArtProps(gift)} size={40} bare />
                    ) : (
                      <Sparkles size={18} className="text-[var(--dim)]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem] font-bold">{SLOT_TITLES[slot]}</span>
                    <span className="block truncate text-[12px] text-[var(--muted)]">
                      {gift
                        ? `${gift.name} #${gift.serial_number}`
                        : locked
                          ? "Откроется с Premium"
                          : "Пусто"}
                    </span>
                  </span>
                  {gift ? (
                    <button
                      type="button"
                      className="icon-button !size-9"
                      aria-label={`Убрать ${gift.name} из шапки`}
                      disabled={clear.isPending}
                      onClick={() => clear.mutate(slot)}
                    >
                      <X size={16} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="quiet-button !h-9 !px-3 !text-[13px]"
                    disabled={place.isPending}
                    onClick={() => (locked ? openPremium() : setPicking(slot))}
                  >
                    {locked ? <Crown size={14} /> : <Plus size={14} />}
                    {gift ? "Заменить" : locked ? "Premium" : "Выбрать"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
