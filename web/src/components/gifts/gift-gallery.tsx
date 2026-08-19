"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Ban,
  HandCoins,
  Check,
  Eye,
  EyeOff,
  Gem,
  Gift,
  History,
  Pin,
  PinOff,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import type { Gift as GiftType } from "@/lib/types";
import { plural, relativeTime } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
import { UserAvatar } from "../user-avatar";
import { GiftImage, giftArtProps } from "./gift-image";
import { GiftArtCredit } from "./gift-art-credit";
import { GiftMarketPanel } from "./gift-market-panel";
import { GiftPurchaseSheet } from "./gift-purchase-sheet";
import { GiftUpgrade } from "./gift-upgrade";
import { OffersPanel } from "./offers-panel";

export type RichGift = GiftType & {
  model?: string;
  symbol?: string;
  background?: string;
  model_rarity_percent?: number;
  symbol_rarity_percent?: number;
  background_rarity_percent?: number;
  value_stars?: number;
  provenance_hash?: string;
};

function traitNumber(gift: RichGift, key: string, fallback?: number) {
  const value = gift.traits?.[key];
  return typeof value === "number" ? value : fallback;
}

const transferSchema = z.object({
  to_username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{3,31}$/, "Введите корректный @юзернейм"),
});
const offerSchema = z.object({
  stars_amount: z.coerce
    .number()
    .int()
    .min(1, "Минимум 1 звезда")
    .max(10_000_000),
});
const labels: Record<GiftType["rarity"], string> = {
  rare: "Редкий",
  epic: "Эпический",
  legendary: "Легендарный",
  mythic: "Мифический",
};

export function GiftGallery({ recipient, inSheet = false }: { recipient?: string; inSheet?: boolean } = {}) {
  const [scope, setScope] = useState<"all" | "mine">(recipient ? "mine" : "all");
  const [buyOpen, setBuyOpen] = useState(false);
  const { data: gifts = [], isLoading } = useQuery({
    queryKey: ["gifts"],
    queryFn: () => api.gifts(),
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const recipientQuery = useQuery({
    queryKey: ["profile", recipient],
    queryFn: () => api.profile(recipient!),
    enabled: Boolean(recipient),
  });
  const visible = (gifts as RichGift[]).filter(
    (gift) =>
      scope === "all" ||
      gift.is_owned_by_me ||
      gift.owner_username === me?.username,
  );

  return (
    <>
      {inSheet ? null : (
        <>
          <div className="mobile-topbar">
            <span className="wordmark">ПОДАРКИ</span>
            <Gift size={20} className="text-[var(--stars)]" />
          </div>
          <section className="relative overflow-hidden px-4 pb-7 pt-8 sm:px-6 sm:pt-11">
            <div className="relative flex items-end justify-between gap-5">
              <div>
                <h1 className="channel-title max-w-[560px]">Коллекционные подарки</h1>
                <p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--muted)]">
                  Подарки можно приобрести, передать и разместить в профиле. Выпуск,
                  владелец и история каждой операции сохраняются в аккаунте.
                </p>
              </div>
              <Link
                href="/stars"
                className="hidden min-h-11 items-center gap-2 rounded-full bg-[var(--surface-raised)] px-4 text-sm font-bold text-[var(--stars)] sm:flex"
              >
                <Star size={18} fill="currentColor" />
                {me?.stars_balance ?? 0}
              </Link>
            </div>
          </section>
        </>
      )}

      <div className="px-3 pb-3 sm:px-5">
        <div className="segmented-control">
          <button data-active={scope === "all"} onClick={() => setScope("all")}>
            Все подарки
          </button>
          <button
            data-active={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            Моя коллекция
          </button>
        </div>
        {/*
          The collection is also where a collector starts: without this the catalogue was only
          reachable from somebody else's profile, so buying a limited design for yourself meant
          opening a stranger's page first.
        */}
        <button
          type="button"
          className="signal-button mt-3 w-full"
          onClick={() => setBuyOpen(true)}
        >
          <ShoppingBag size={18} />
          {recipient ? `Купить подарок для @${recipient}` : "Купить подарок себе или другому"}
        </button>
      </div>
      <GiftPurchaseSheet recipient={recipient} open={buyOpen} onOpenChange={setBuyOpen} />
      {recipient ? (
        <section className="mx-3 mb-3 sm:mx-5">
          <div className="flex items-center gap-3 rounded-[20px] bg-[#121216] p-3 shadow-[inset_0_0_0_1px_#2a2a33]">
            <span className="relative size-11 flex-none overflow-hidden rounded-full bg-[#17171d]">
              {recipientQuery.data?.avatar_url ? (
                <Image src={recipientQuery.data.avatar_url} alt="" fill sizes="44px" className="object-cover" />
              ) : (
                <span className="grid h-full place-items-center text-sm font-black text-[var(--primary-strong)]">
                  {(recipientQuery.data?.display_name ?? recipient).slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-0 text-[0.68rem] font-extrabold uppercase tracking-[.1em] text-[var(--faint)]">Отправка подарка</p>
              <strong className="block truncate text-sm">
                {recipientQuery.isLoading ? "Загрузка получателя…" : recipientQuery.isError ? `@${recipient}` : `${recipientQuery.data?.display_name} · @${recipientQuery.data?.username}`}
              </strong>
              <span className="text-xs text-[var(--muted)]">Выберите предмет из своей коллекции — получатель уже подставлен.</span>
            </div>
            <Link href={`/u/${recipient}`} className="quiet-button !min-h-10 !px-3 text-xs">Профиль</Link>
          </div>
        </section>
      ) : null}

      {inSheet ? null : (
        <div className="flex items-center justify-between border-y border-[var(--line)] px-4 py-3.5 text-xs sm:px-6">
          <span className="flex items-center gap-2 text-[var(--muted)]">
            <ShieldCheck size={16} className="text-[var(--online)]" />
            Подтверждённые операции
          </span>
          <span className="font-bold text-[var(--stars)]">
            {visible.length} {plural(visible.length, "предмет", "предмета", "предметов")}
          </span>
        </div>
      )}

      <div className="pt-4">
        <OffersPanel />
        <GiftMarketPanel balance={me?.stars_balance ?? 0} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 sm:gap-3 sm:p-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton aspect-square rounded-[16px]" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 sm:gap-3 sm:p-5">
          {visible.map((gift, index) => (
            <GiftCard
              key={gift.id}
              gift={gift}
              index={index}
              me={me?.username}
              recipient={recipient}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Gift className="mx-auto mb-3 text-[var(--stars)]" />
          <p className="font-bold text-white">Коллекция пока пуста</p>
          <button className="quiet-button mt-3" onClick={() => setScope("all")}>
            Посмотреть каталог
          </button>
        </div>
      )}

      <GiftArtCredit className="mx-4 mb-4 sm:mx-6" />

      <section className="surface mx-3 mb-8 p-4 sm:mx-5 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 flex-none place-items-center rounded-[15px] bg-[#17171d] text-[var(--link)]">
            <History size={20} />
          </span>
          <div>
            <h2 className="m-0 text-base font-bold">
              История предмета не стирается
            </h2>
            <p className="mb-0 mt-1 max-w-[65ch] text-sm leading-6 text-[var(--muted)]">
              Выпуск, приобретение, предложения и передачи фиксируются
              отдельными событиями и доступны владельцу.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Collectible tile, following the reference's own anatomy: a 117x129 accent panel with a
 * centre glow, a folded corner carrying the serial, and the name printed underneath rather
 * than over the artwork.
 */
export function GiftCard({
  gift,
  index,
  me,
  recipient,
}: {
  gift: RichGift;
  index: number;
  me?: string;
  recipient?: string;
}) {
  const [open, setOpen] = useState(false);
  const accent = gift.accent ?? "#2a2e37";
  const mine = gift.is_owned_by_me || gift.owner_username === me;
  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        aria-label={`Открыть подарок ${gift.name} #${gift.serial_number}`}
        className="group min-w-0 border-0 bg-transparent p-0 text-left"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.04, 0.18), duration: 0.28 }}
      >
        <span className="relative block aspect-[117/129] overflow-hidden rounded-[10px]">
          {/*
            Full-bleed and not `bare`: the item draws its own rolled backdrop, exactly as the
            storefront tile does, so one gift looks the same in the shop and in a collection.
          */}
          <span className="absolute inset-0">
            <GiftImage
              {...giftArtProps(gift)}
              size={132}
              rounded="rounded-none"
              fill
              className="transition-transform duration-500 group-hover:scale-[1.06]"
            />
          </span>
          <SerialCorner serial={gift.serial_number} accent={accent} />
          {gift.is_listed ? (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-[var(--stars)] px-1.5 py-0.5 text-[0.55rem] font-extrabold text-black">
              <Star size={8} fill="currentColor" />
              {gift.sale_price_stars}
            </span>
          ) : null}
          {gift.upgraded === false ? (
            <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.55rem] font-bold text-white">
              {mine ? "Улучшить" : "Обычный"}
            </span>
          ) : mine ? (
            <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.55rem] font-bold text-white">
              Ваш
            </span>
          ) : null}
        </span>
        <strong className="mt-1.5 block truncate text-[13px] font-semibold leading-tight">
          {gift.name}
        </strong>
        <span className="block truncate text-[11px] leading-tight text-[var(--dim)]">
          {labels[gift.rarity]}
        </span>
      </motion.button>
      {open ? (
        <GiftDialog
          gift={gift}
          me={me}
          recipient={recipient}
          close={() => setOpen(false)}
          open={open}
        />
      ) : null}
    </>
  );
}

/** Folded top-right corner with the serial, as the reference draws it. */
function SerialCorner({ serial, accent }: { serial: number; accent: string }) {
  const id = `corner-${serial}-${accent.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <span className="pointer-events-none absolute right-0 top-0 size-12">
      <svg viewBox="0 0 56 56" className="size-full" aria-hidden>
        <defs>
          <linearGradient id={id} x1="28" y1="1" x2="28" y2="55" gradientUnits="userSpaceOnUse">
            <stop stopColor={shade(accent, 0.15)} />
            <stop offset="1" stopColor={shade(accent, 0.6)} />
          </linearGradient>
        </defs>
        <path
          d="M52.4851 26.4853L29.5145 3.51472C27.2641 1.26428 24.2119 0 21.0293 0H2.82824C1.04643 0 0.154103 2.15429 1.41403 3.41422L52.5856 54.5858C53.8455 55.8457 55.9998 54.9534 55.9998 53.1716V34.9706C55.9998 31.788 54.7355 28.7357 52.4851 26.4853Z"
          fill={`url(#${id})`}
        />
      </svg>
      <span
        className="absolute left-1/2 top-1/2 whitespace-nowrap text-[10px] font-bold text-white/90"
        style={{ transform: "translate(-50%, -50%) translate(5px, -5px) rotate(45deg)" }}
      >
        #{serial.toLocaleString("ru-RU")}
      </span>
    </span>
  );
}

/** Darken a hex accent for the tile's vertical falloff and the corner gradient. */
function shade(hex: string, amount: number) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (full.length !== 6) return hex;
  const channels = [0, 2, 4].map((offset) =>
    Math.max(0, Math.round(parseInt(full.slice(offset, offset + 2), 16) * (1 - amount)))
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Opens a collectible from anywhere outside the grid — the profile's identity row, for
 * instance. Fetches the full record on open, because compact embeds carry only a summary
 * and the sheet needs traits, edition and provenance.
 */
export function GiftDetailTrigger({
  gift,
  me,
  className,
  style,
  label,
  children,
}: {
  gift: RichGift;
  me?: string;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const full = useQuery({
    queryKey: ["gift", gift.id],
    queryFn: () => api.gift(gift.id),
    enabled: open,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        style={style}
        aria-label={label ?? `Открыть подарок ${gift.name} #${gift.serial_number}`}
      >
        {children}
      </button>
      {open ? (
        <GiftDialog
          gift={(full.data as RichGift | undefined) ?? gift}
          me={me}
          close={() => setOpen(false)}
          open={open}
        />
      ) : null}
    </>
  );
}

function GiftDialog({
  gift,
  me,
  recipient,
  close,
  open,
}: {
  gift: RichGift;
  me?: string;
  recipient?: string;
  close: () => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmTransfer, setConfirmTransfer] = useState(Boolean(recipient));
  const [feedback, setFeedback] = useState("");
  const mine = gift.is_owned_by_me || gift.owner_username === me;
  const provenance = useQuery({
    queryKey: ["gift-provenance", gift.id],
    queryFn: () => api.giftProvenance(gift.id),
    enabled: open,
  });
  const offers = useQuery({
    queryKey: ["gift-offers", gift.id],
    queryFn: () => api.giftOffers(gift.id),
    enabled: open && mine,
  });
  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { to_username: recipient ?? "" },
  });
  const offerForm = useForm<
    z.input<typeof offerSchema>,
    unknown,
    z.output<typeof offerSchema>
  >({
    resolver: zodResolver(offerSchema),
    defaultValues: { stars_amount: Math.max(gift.value_stars ?? 100, 1) },
  });
  const transfer = useMutation({
    mutationFn: ({ to_username }: z.infer<typeof transferSchema>) =>
      api.transferGift(gift.id, to_username),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
      close();
    },
  });
  const offer = useMutation({
    mutationFn: ({ stars_amount }: z.output<typeof offerSchema>) =>
      api.makeGiftOffer(gift.id, stars_amount),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["gift-offers", gift.id],
      });
      setFeedback("Предложение отправлено владельцу");
      offerForm.reset();
    },
  });
  const resolveOffer = useMutation<unknown, Error, { id: string; action: "accept" | "decline" }>({
    mutationFn: ({ id, action }) =>
      action === "accept" ? api.acceptGiftOffer(id) : api.declineGiftOffer(id),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gift-offers", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-offers-incoming"] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      if (variables.action === "accept") close();
      else setFeedback("Предложение отклонено");
    },
  });
  const showcase = useMutation({
    mutationFn: (slot: "featured" | "name") =>
      api.setGiftShowcase(gift.id, slot),
    onSuccess: async (_, slot) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", me] }),
      ]);
      setFeedback(
        slot === "featured"
          ? "Подарок установлен в шапку"
          : "Подарок установлен рядом с именем",
      );
    },
  });
  const target = useWatch({
    control: transferForm.control,
    name: "to_username",
  });
  const [askPrice, setAskPrice] = useState(String(Math.max(gift.value_stars ?? 100, 1)));
  const upgrade = useMutation({
    mutationFn: () => api.upgradeGift(gift.id),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-provenance", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", me] }),
      ]);
      // The rolled model is the news, so it is what the notice says.
      setFeedback(`Выпала модель «${updated.model ?? updated.model_name}»`);
    },
    onError: (error: Error) => setFeedback(error.message),
  });
  const listing = useMutation({
    mutationFn: (price: number | null) => api.setGiftListing(gift.id, price),    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-market"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-design"] }),
      ]);
      setFeedback(
        updated.is_listed
          ? `Выставлен на маркет за ${updated.sale_price_stars} ★`
          : "Снят с продажи",
      );
    },
  });
  const unpin = useMutation({
    mutationFn: (slot: "featured" | "name") =>
      api.updateShowcase(slot === "featured" ? { featured_gift_id: null } : { name_gift_id: null }),
    onSuccess: async (_result, slot) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", me] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
      ]);
      setFeedback(slot === "featured" ? "Убран из шапки" : "Убран из имени");
    },
  });
  const offersClosed = useMutation({
    mutationFn: (disabled: boolean) => api.setGiftOffersDisabled(gift.id, disabled),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-offers", gift.id] }),
      ]);
      setFeedback(
        updated.offers_disabled
          ? "Больше никто не предложит цену за этот подарок"
          : "Предложения снова открыты",
      );
    },
    onError: (error: Error) => setFeedback(error.message),
  });
  const visibility = useMutation({
    mutationFn: (hidden: boolean) => api.setGiftVisibility(gift.id, hidden),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", me] }),
      ]);
      setFeedback(
        updated.hidden_in_profile ? "Подарок скрыт из профиля" : "Подарок снова в профиле",
      );
    },
  });
  const pin = useMutation({
    mutationFn: (pinned: boolean) => api.pinGift(gift.id, pinned),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["profile", me] }),
      ]);
      setFeedback(
        updated.is_pinned ? "Закреплён в начале коллекции" : "Откреплён",
      );
    },
  });
  const buyNow = useMutation({
    mutationFn: () => api.buyGift(gift.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["gift", gift.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-market"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      close();
    },
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => (next ? null : close())}
      title={`${gift.name} #${gift.serial_number}`}
      description="Свойства, владелец и история коллекционного подарка."
      className="!px-0"
    >
      <div className="-mx-4">
        <div
          className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden p-8 text-center"
          style={{
            background: `radial-gradient(120% 90% at 50% 0%, ${gift.accent ?? "#2a2530"} 0%, ${gift.backdrop_edge ?? "#0b0b0e"} 100%)`,
          }}
        >
          <GiftUpgrade
            gift={gift}
            size={190}
            canUpgrade={mine}
            pending={upgrade.isPending}
            justUpgraded={upgrade.isSuccess}
            onUpgrade={() => upgrade.mutate()}
          />
          <h2 className="relative mb-0 mt-4 text-2xl font-extrabold">
            {gift.name} #{gift.serial_number}
          </h2>
          <p className="relative mb-0 mt-1 text-sm text-white/80">
            {gift.model ?? labels[gift.rarity]}
          </p>
          {gift.message ? (
            <p className="relative mb-0 mt-3 max-w-[34ch] rounded-[16px] bg-black/45 px-3.5 py-2 text-sm leading-5 text-white/90">
              «{gift.message}»
              <span className="mt-1 block text-[12px] text-white/60">
                {gift.sender_hidden
                  ? "Отправитель скрыл имя"
                  : gift.sender
                    ? `от ${gift.sender.display_name}`
                    : null}
              </span>
            </p>
          ) : null}
          <Dialog.Close
            className="icon-button absolute right-4 top-4 bg-black/40 text-white"
            aria-label="Закрыть"
          >
            <X size={20} />
          </Dialog.Close>
        </div>
        <div className="p-4">
          <div className="overflow-hidden rounded-[20px] bg-[#17171d] shadow-[inset_0_0_0_1px_var(--line)]">
            <DetailRow label="Тип">
              <strong>Коллекционный</strong>
            </DetailRow>
            <DetailRow label="Владелец">
                {gift.owner_username ? (
                  <Link
                    href={`/u/${gift.owner_username}`}
                    className="font-bold text-[var(--link)]"
                  >
                    @{gift.owner_username}
                  </Link>
                ) : (
                  <span className="text-[var(--muted)]">Загрузка…</span>
                )}
              </DetailRow>
              {/*
                Who gave it, and not only when they left a note. A gift is a gift because
                somebody chose it: reading the row said "коллекционный предмет" and nothing
                about the person. Opening one I gave says so, even if I hid my name from its
                owner — I am not hiding it from myself.
              */}
              {gift.sender || gift.sender_hidden || gift.sent_by_me ? (
                <DetailRow label="Подарил">
                  {gift.sent_by_me ? (
                    <span className="flex items-center gap-1.5">
                      <strong>Вы</strong>
                      {gift.sender_hidden ? (
                        <span className="text-[12px] text-[var(--muted)]">
                          (имя скрыто от владельца)
                        </span>
                      ) : null}
                    </span>
                  ) : gift.sender ? (
                    <Link
                      href={`/u/${gift.sender.username}`}
                      className="font-bold text-[var(--link)]"
                    >
                      @{gift.sender.username}
                    </Link>
                  ) : (
                    <span className="text-[var(--muted)]">Имя скрыто</span>
                  )}
                </DetailRow>
              ) : null}
              <DetailRow label="Модель">
                <strong>{gift.model ?? "Original"}</strong>
                <Rarity
                  value={traitNumber(
                    gift,
                    "model_rarity_percent",
                    gift.model_rarity_percent,
                  )}
                />
              </DetailRow>
              <DetailRow label="Символ">
                <strong>{gift.symbol ?? "GRAM"}</strong>
                <Rarity
                  value={traitNumber(
                    gift,
                    "symbol_rarity_percent",
                    gift.symbol_rarity_percent,
                  )}
                />
              </DetailRow>
              <DetailRow label="Фон">
                <strong>
                  {gift.backdrop ?? gift.background ?? "Midnight"}
                </strong>
                <Rarity
                  value={traitNumber(
                    gift,
                    "backdrop_rarity_percent",
                    gift.background_rarity_percent,
                  )}
                />
              </DetailRow>
              <DetailRow label="Выпуск">
                <strong>
                  #{gift.serial_number}
                  {gift.edition_size ?? gift.supply ? ` из ${gift.edition_size ?? gift.supply}` : ""}
                </strong>
              </DetailRow>
              <DetailRow label="Ценность">
                <strong className="text-[var(--stars)]">
                  ★ {gift.value_stars ?? 0}
                </strong>
              </DetailRow>
            </div>
            {gift.description ? (
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                {gift.description}
              </p>
            ) : null}
            <section className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="m-0 text-base font-bold">История владения</h3>
                {gift.provenance_hash ? (
                  <span
                    className="max-w-32 truncate text-[0.65rem] text-[var(--faint)]"
                    title={gift.provenance_hash}
                  >
                    {gift.provenance_hash}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                {provenance.isLoading ? (
                  <div className="skeleton h-16 rounded-[18px]" />
                ) : (
                  provenance.data?.map((event, index) => (
                    <div
                      key={event.id ?? `${event.event}-${index}`}
                      className="flex items-center gap-3 rounded-[18px] bg-[#17171d] p-3"
                    >
                      <span className="grid size-9 flex-none place-items-center rounded-full bg-[#27272a] text-[var(--primary-strong)]">
                        <History size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-semibold">
                          {event.event === "transferred"
                            ? "Передача владельцу"
                            : event.event === "purchased"
                              ? "Покупка"
                              : event.event === "featured"
                                ? "Закрепление в профиле"
                                : "Выпуск предмета"}
                        </p>
                        <p className="mb-0 mt-1 truncate text-xs text-[var(--muted)]">
                          {event.to_user
                            ? `@${event.to_user.username}`
                            : "GRAM collection"}{" "}
                          · {relativeTime(event.occurred_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                {!provenance.isLoading && !provenance.data?.length ? (
                  <p className="text-sm text-[var(--muted)]">
                    История начнётся с выпуска предмета.
                  </p>
                ) : null}
              </div>
            </section>
            {mine ? (
              <section className="mt-5 rounded-[22px] bg-[#17171d] p-4">
                <h3 className="m-0 text-base font-bold">
                  Разместить в профиле
                </h3>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  Можно выбрать отдельное место в шапке и компактный знак возле
                  имени.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {gift.showcased_as === "featured" ? (
                    <button
                      className="quiet-button !px-3"
                      onClick={() => unpin.mutate("featured")}
                      disabled={unpin.isPending}
                    >
                      <X size={17} />Убрать из шапки
                    </button>
                  ) : (
                    <button
                      className="quiet-button !px-3"
                      onClick={() => showcase.mutate("featured")}
                      disabled={showcase.isPending || gift.hidden_in_profile}
                    >
                      <Sparkles size={17} />В шапку
                    </button>
                  )}
                  {gift.showcased_as === "name" ? (
                    <button
                      className="quiet-button !px-3"
                      onClick={() => unpin.mutate("name")}
                      disabled={unpin.isPending}
                    >
                      <X size={17} />Убрать из имени
                    </button>
                  ) : (
                    <button
                      className="gold-button !px-3"
                      onClick={() => showcase.mutate("name")}
                      disabled={showcase.isPending || gift.hidden_in_profile}
                    >
                      <Gem size={17} />В имя
                    </button>
                  )}
                </div>
                {/*
                  Pinning is about order in the collection, not about the two places on the
                  header: a pinned item leads the grid however old it is.
                */}
                <button
                  className="quiet-button mt-2 w-full"
                  onClick={() => pin.mutate(!gift.is_pinned)}
                  disabled={pin.isPending}
                >
                  {gift.is_pinned ? <PinOff size={17} /> : <Pin size={17} />}
                  {gift.is_pinned ? "Открепить из коллекции" : "Закрепить в коллекции"}
                </button>
                {/*
                  Hiding is curation, not disposal: the item stays owned, keeps its provenance
                  and can still be sold — it just leaves the public grid, so pinning it is off.
                */}
                <button
                  className="quiet-button mt-2 w-full"
                  onClick={() => visibility.mutate(!gift.hidden_in_profile)}
                  disabled={visibility.isPending}
                >
                  {gift.hidden_in_profile ? <Eye size={17} /> : <EyeOff size={17} />}
                  {gift.hidden_in_profile ? "Показать в профиле" : "Скрыть из профиля"}
                </button>
                {/*
                  Declining offers one at a time tells a buyer to try again. Saying once that
                  the item is not for sale is the honest version, and the server refuses them.
                */}
                <button
                  className="quiet-button mt-2 w-full"
                  onClick={() => offersClosed.mutate(!gift.offers_disabled)}
                  disabled={offersClosed.isPending}
                >
                  {gift.offers_disabled ? <HandCoins size={17} /> : <Ban size={17} />}
                  {gift.offers_disabled
                    ? "Разрешить предложения цены"
                    : "Не предлагать мне цену"}
                </button>
                {gift.offers_disabled ? (
                  <p className="mb-0 mt-2 text-xs text-[var(--muted)]">
                    Новые предложения по этому подарку отклоняются автоматически. Выставить его
                    на маркет по своей цене это не мешает.
                  </p>
                ) : null}
                {gift.hidden_in_profile ? (
                  <p className="mb-0 mt-2 text-xs text-[var(--muted)]">
                    Виден только вам. Историю владения и продажу это не затрагивает.
                  </p>
                ) : null}
              </section>
            ) : null}
            {mine ? (
              <section className="mt-4 rounded-[22px] bg-[#17171d] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 flex items-center gap-1.5 text-base font-bold">
                    <Tag size={17} className="text-[var(--stars)]" />
                    Продать на маркете
                  </h3>
                  {gift.is_listed ? (
                    <span className="flex items-center gap-1 rounded-full bg-[var(--stars)] px-2.5 py-1 text-xs font-extrabold text-black">
                      <Star size={11} fill="currentColor" />
                      {gift.sale_price_stars}
                    </span>
                  ) : null}
                </div>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  Цена видна всем: любой купит предмет одним нажатием, без ожидания ответа.
                </p>
                {gift.is_listed ? (
                  <button
                    className="quiet-button mt-3 w-full"
                    onClick={() => listing.mutate(null)}
                    disabled={listing.isPending}
                  >
                    {listing.isPending ? "Убираем…" : "Снять с продажи"}
                  </button>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <label className="field flex min-w-0 flex-1 items-center gap-2 px-3">
                      <Star size={17} className="text-[var(--stars)]" fill="currentColor" />
                      <input
                        type="number"
                        min={1}
                        value={askPrice}
                        onChange={(event) => setAskPrice(event.target.value)}
                        aria-label="Цена в звёздах"
                        className="min-w-0 flex-1 bg-transparent outline-none"
                      />
                    </label>
                    <button
                      className="gold-button"
                      onClick={() => listing.mutate(Math.max(1, Number(askPrice) || 0))}
                      disabled={listing.isPending || !Number(askPrice)}
                    >
                      {listing.isPending ? "…" : "Выставить"}
                    </button>
                  </div>
                )}
                {listing.error ? (
                  <p className="mb-0 mt-2 text-xs text-[var(--danger)]">{listing.error.message}</p>
                ) : null}
              </section>
            ) : gift.is_listed ? (
              <section className="mt-5 rounded-[22px] bg-[#17171d] p-4">
                <h3 className="m-0 flex items-center gap-1.5 text-base font-bold">
                  <ShoppingBag size={17} className="text-[var(--stars)]" />
                  Продаётся сейчас
                </h3>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  Владелец назвал цену — предмет перейдёт вам сразу после оплаты.
                </p>
                <button
                  className="gold-button mt-3 w-full"
                  onClick={() => buyNow.mutate()}
                  disabled={buyNow.isPending}
                >
                  <Star size={17} fill="currentColor" />
                  {buyNow.isPending ? "Покупаем…" : `Купить за ${gift.sale_price_stars} ★`}
                </button>
                {buyNow.error ? (
                  <p className="mb-0 mt-2 text-xs text-[var(--danger)]">{buyNow.error.message}</p>
                ) : null}
              </section>
            ) : null}
            {mine ? (
              <section className="mt-4 rounded-[22px] bg-[#17171d] p-4">
                {/* Offers only mattered once the owner could act on them from here. */}
                {offers.data?.some((item) => item.status === "pending") ? (
                  <div className="mb-4">
                    <h3 className="m-0 text-base font-bold">Предложения</h3>
                    <ul className="m-0 mt-2.5 grid list-none gap-2 p-0">
                      {offers.data
                        .filter((item) => item.status === "pending")
                        .map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center gap-2.5 rounded-[16px] bg-[#0f0f13] p-2.5"
                          >
                            <UserAvatar
                              src={item.buyer.avatar_url}
                              name={item.buyer.display_name}
                              size={36}
                              ringColor="transparent"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold">
                                {item.buyer.display_name}
                              </span>
                              <span className="text-xs text-[var(--muted)]">
                                @{item.buyer.username} · {relativeTime(item.created_at)}
                              </span>
                            </span>
                            <strong className="flex-none text-sm text-[var(--stars)]">
                              {item.amount_stars} ★
                            </strong>
                            <button
                              type="button"
                              className="grid size-9 flex-none place-items-center rounded-full border-0 bg-[var(--online)] text-black disabled:opacity-50"
                              aria-label={`Принять ${item.amount_stars} ★ от @${item.buyer.username}`}
                              disabled={resolveOffer.isPending}
                              onClick={() => resolveOffer.mutate({ id: item.id, action: "accept" })}
                            >
                              <Check size={17} />
                            </button>
                            <button
                              type="button"
                              className="grid size-9 flex-none place-items-center rounded-full border-0 bg-[#2b2024] text-[var(--danger)] disabled:opacity-50"
                              aria-label={`Отклонить предложение @${item.buyer.username}`}
                              disabled={resolveOffer.isPending}
                              onClick={() => resolveOffer.mutate({ id: item.id, action: "decline" })}
                            >
                              <X size={17} />
                            </button>
                          </li>
                        ))}
                    </ul>
                    {resolveOffer.error ? (
                      <p className="mb-0 mt-2 text-xs text-[var(--danger)]">
                        {resolveOffer.error.message}
                      </p>
                    ) : null}
                    <div className="mt-4 h-px bg-[var(--line)]" />
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <h3 className="m-0 text-base font-bold">Передать подарок</h3>
                  {offers.data?.length ? (
                    <span className="text-xs text-[var(--muted)]">
                      {offers.data.length} предложений
                    </span>
                  ) : null}
                </div>
                {confirmTransfer ? (
                  <div className="mt-3 rounded-[18px] bg-[#2b2024] p-4">
                    <p className="m-0 text-sm leading-5">
                      Передать{" "}
                      <strong>
                        {gift.name} #{gift.serial_number}
                      </strong>{" "}
                      пользователю <strong>@{target}</strong>? Отменить
                      завершённую передачу нельзя.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="quiet-button flex-1"
                        onClick={() => setConfirmTransfer(false)}
                      >
                        Назад
                      </button>
                      <button
                        className="signal-button flex-1"
                        onClick={transferForm.handleSubmit((values) =>
                          transfer.mutate(values),
                        )}
                        disabled={transfer.isPending}
                      >
                        {transfer.isPending ? "Передаём…" : "Подтвердить"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    className="mt-3"
                    onSubmit={transferForm.handleSubmit(() =>
                      setConfirmTransfer(true),
                    )}
                  >
                    <div className="flex gap-2">
                      <label className="field flex min-w-0 flex-1 items-center px-3">
                        <span className="text-[var(--link)]">@</span>
                        <input
                          className="min-w-0 flex-1 bg-transparent outline-none"
                          placeholder="username"
                          {...transferForm.register("to_username")}
                        />
                      </label>
                      <button
                        className="signal-button !size-12 !p-0"
                        aria-label="Продолжить передачу"
                      >
                        <Send size={18} />
                      </button>
                    </div>
                    <p className="mb-0 mt-2 min-h-5 text-xs text-[var(--danger)]">
                      {transferForm.formState.errors.to_username?.message ??
                        transfer.error?.message}
                    </p>
                  </form>
                )}
              </section>
            ) : (
              <section className="mt-5 rounded-[22px] bg-[#17171d] p-4">
                <h3 className="m-0 text-base font-bold">Предложить цену</h3>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  Звёзды резервируются только после принятия предложения
                  владельцем.
                </p>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={offerForm.handleSubmit((values) =>
                    offer.mutate(values),
                  )}
                >
                  <label className="field flex min-w-0 flex-1 items-center gap-2 px-3">
                    <Star
                      size={17}
                      className="text-[var(--stars)]"
                      fill="currentColor"
                    />
                    <input
                      type="number"
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      {...offerForm.register("stars_amount")}
                    />
                  </label>
                  <button className="gold-button" disabled={offer.isPending}>
                    {offer.isPending ? "Отправляем…" : "Предложить"}
                  </button>
                </form>
                <p className="mb-0 mt-2 min-h-5 text-xs text-[var(--danger)]">
                  {offerForm.formState.errors.stars_amount?.message ??
                    offer.error?.message}
                </p>
              </section>
            )}
            <p
              className="mb-0 mt-4 min-h-5 text-center text-sm text-[var(--online)]"
              aria-live="polite"
            >
              {feedback}
            </p>
            <button className="quiet-button mt-2 w-full" onClick={close}>
              <Check size={17} />
              Готово
            </button>
          </div>
        </div>
    </BottomSheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[90px_1fr] items-center gap-3 border-b border-[var(--line)] px-3 last:border-0 sm:grid-cols-[120px_1fr]">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {children}
      </span>
    </div>
  );
}

function Rarity({ value }: { value?: number }) {
  return value == null ? null : (
    <span className="rounded-full bg-[#1d3441] px-2 py-0.5 text-[0.65rem] font-bold text-[var(--link)]">
      {value}%
    </span>
  );
}
