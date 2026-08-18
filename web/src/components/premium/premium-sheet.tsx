"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  BadgeCheck,
  CreditCard,
  Crown,
  Download,
  Gauge,
  Gem,
  ImageIcon,
  Languages,
  Palette,
  RefreshCw,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Star,
  Upload,
  Video,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  PremiumBenefit,
  PremiumLimit,
  PremiumPaymentMethod,
} from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  crown: Crown,
  palette: Palette,
  "badge-check": BadgeCheck,
  sparkles: Sparkles,
  gauge: Gauge,
  "audio-lines": AudioLines,
  languages: Languages,
  "smile-plus": SmilePlus,
  video: Video,
  image: ImageIcon,
  upload: Upload,
  download: Download,
};

const METHOD_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  stars: Star,
  card: CreditCard,
  crypto: Gem,
};

/** Premium is a sheet on phones and a centred modal on desktop, like the reference. */
export function PremiumSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const plan = useQuery({
    queryKey: ["premium-plan"],
    queryFn: api.premiumPlan,
    enabled: open,
  });
  const purchase = useMutation({
    mutationFn: api.purchasePremium,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["premium-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["premium"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars", "wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["stars", "transactions"] }),
      ]);
      notify("GRAM Premium оформлен", { variant: "success", detail: "Оформление профиля и лимиты уже активны" });
    },
    onError: (error: Error) =>
      notify("Не удалось оформить Premium", { variant: "error", detail: error.message }),
  });

  const data = plan.data;
  const active = Boolean(data?.entitlement?.active);
  const balance = data?.stars_balance ?? 0;
  const priceStars = data?.price_stars ?? 0;
  const affordable = balance >= priceStars;
  const fiat = data
    ? `${data.price_fiat} ${data.fiat_currency === "UAH" ? "грн" : data.fiat_currency}`
    : "";

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="GRAM Premium"
      description="Подписка GRAM Premium: оформление профиля, расширенные лимиты и ранний доступ."
      headerRight={
        <>
          {data ? (
            <span className="rounded-full bg-[#27272a] px-2.5 py-1 text-[0.7rem] font-extrabold">
              {data.period_days} дней
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="icon-button !size-9 bg-[#27272a]"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </>
      }
      footer={
        data ? (
          <div className="px-1">
            <button
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border-0 bg-[#27272a] px-5 text-[0.95rem] font-extrabold text-[var(--muted)]"
              disabled
              title="Оплата картой и криптовалютой появится позже"
            >
              Оплата картой · {fiat}
              <span className="rounded-full bg-[#2e2e37] px-2 py-0.5 text-[0.58rem] uppercase tracking-[.1em] text-[var(--faint)]">
                скоро
              </span>
            </button>
            <button
              className="mt-2.5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border-0 px-5 text-[1rem] font-extrabold disabled:opacity-60"
              style={{
                background: active ? "#27272a" : "#3a2f0f",
                color: active ? "var(--muted)" : "var(--stars)",
              }}
              onClick={() => purchase.mutate()}
              disabled={active || purchase.isPending || !affordable}
            >
              <Sparkles size={18} />
              {active
                ? "Premium активен"
                : purchase.isPending
                  ? "Оформляем…"
                  : `Оплатить звёздами · ${priceStars}`}
              {!active ? <Star size={16} fill="currentColor" /> : null}
            </button>
            <button
              className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-2 border-0 bg-transparent text-sm font-bold text-[var(--muted)]"
              onClick={() => plan.refetch()}
              disabled={plan.isFetching}
            >
              <RefreshCw
                size={15}
                className={plan.isFetching ? "animate-spin" : undefined}
              />
              Обновить статус подписки
            </button>
            <p
              className="mb-0 mt-1.5 min-h-5 text-center text-xs"
              aria-live="polite"
            >
              {purchase.error ? (
                <span className="text-[var(--danger)]">
                  {purchase.error.message}
                </span>
              ) : !affordable && !active ? (
                <span className="text-[var(--muted)]">
                  На балансе {balance} ★ — нужно ещё {priceStars - balance} ★
                </span>
              ) : null}
            </p>
          </div>
        ) : null
      }
    >
      <div className="pt-2">
        <motion.div
          initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="text-center">
            <span className="mx-auto grid size-[76px] place-items-center rounded-[26px] bg-[#17171d] text-white shadow-[inset_0_0_0_1px_#27272a]">
              <Star size={34} fill="currentColor" />
            </span>
            <h2 className="m-0 mt-3.5 text-[1.6rem] font-extrabold tracking-[-0.03em]">
              GRAM Premium
            </h2>
            <p className="mx-auto mb-0 mt-2 max-w-[34ch] text-[0.92rem] leading-6 text-[var(--muted)]">
              Красивый профиль, расширенные лимиты и ранний доступ к новым
              функциям.
            </p>
            {data ? (
              <span className="mt-3.5 inline-flex items-baseline gap-1.5 rounded-full bg-[#17171d] px-4 py-2 shadow-[inset_0_0_0_1px_#27272a]">
                <strong className="text-[1.05rem]">{fiat}</strong>
                <span className="text-xs text-[var(--muted)]">/ месяц</span>
              </span>
            ) : null}
            {active && data?.entitlement ? (
              <p className="mb-0 mt-3 text-sm font-semibold text-[var(--online)]">
                Активна до{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date(data.entitlement.expires_at))}
              </p>
            ) : null}
          </div>

          {plan.isLoading ? (
            <div className="mt-6 space-y-3">
              <div className="skeleton h-40 rounded-[20px]" />
              <div className="skeleton h-32 rounded-[20px]" />
            </div>
          ) : plan.isError ? (
            <div className="empty-state">
              <RefreshCw className="mx-auto mb-3 text-[var(--danger)]" />
              <p className="font-bold text-white">
                Не удалось загрузить подписку
              </p>
              <p className="text-sm">{plan.error.message}</p>
              <button
                className="quiet-button mt-3"
                onClick={() => plan.refetch()}
              >
                <RefreshCw size={16} />
                Повторить
              </button>
            </div>
          ) : data ? (
            <>
              <SheetCard title="Что входит в подписку">
                {data.benefits.map((benefit) => (
                  <BenefitRow key={benefit.slug} benefit={benefit} />
                ))}
              </SheetCard>
              <SheetCard title="Лимиты Free / Premium">
                {data.limits.map((limit) => (
                  <LimitRow key={limit.slug} limit={limit} />
                ))}
              </SheetCard>
              <SheetCard
                title="Оплата"
                aside={
                  <span className="flex items-center gap-1.5 rounded-full bg-[#17171d] px-2.5 py-1 text-[0.68rem] font-bold text-[var(--muted)]">
                    <ShieldCheck size={13} className="text-[var(--online)]" />
                    безопасная оплата
                  </span>
                }
              >
                {data.payment_methods.map((method) => (
                  <MethodRow
                    key={method.slug}
                    method={method}
                    balance={balance}
                  />
                ))}
              </SheetCard>
            </>
          ) : null}
        </motion.div>
      </div>
    </BottomSheet>
  );
}

function SheetCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-[20px] bg-[#121216] shadow-[inset_0_0_0_1px_var(--line)]">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="m-0 text-[0.68rem] font-extrabold uppercase tracking-[.14em] text-[var(--faint)]">
          {title}
        </h3>
        {aside}
      </header>
      <div className="border-t border-[var(--line)]">{children}</div>
    </section>
  );
}

function BenefitRow({ benefit }: { benefit: PremiumBenefit }) {
  const Icon = ICONS[benefit.icon] ?? Sparkles;
  return (
    <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3.5 last:border-0">
      <span className="grid size-9 flex-none place-items-center rounded-full bg-[#17171d] text-[var(--primary-strong)]">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[0.92rem]">{benefit.title}</strong>
          {benefit.soon ? (
            <span className="rounded-full bg-[#27272a] px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-[.1em] text-[var(--faint)]">
              скоро
            </span>
          ) : null}
        </div>
        <p className="mb-0 mt-1 text-[0.84rem] leading-5 text-[var(--muted)]">
          {benefit.description}
        </p>
      </div>
    </div>
  );
}

function LimitRow({ limit }: { limit: PremiumLimit }) {
  const freeWidth = Math.max(
    8,
    Math.round((limit.free / Math.max(limit.premium, 1)) * 100),
  );
  return (
    <div className="border-b border-[var(--line)] px-4 py-3.5 last:border-0">
      <strong className="block text-[0.92rem]">{limit.title}</strong>
      <div className="mt-2.5 grid gap-2">
        <div className="flex items-center gap-3">
          <span className="w-[62px] flex-none text-[0.62rem] font-extrabold uppercase tracking-[.1em] text-[var(--faint)]">
            free
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#27272a]">
            <span
              className="block h-full rounded-full bg-[#4a4a55]"
              style={{ width: `${freeWidth}%` }}
            />
          </span>
          <strong className="w-[52px] flex-none text-right text-[0.82rem] text-[var(--muted)]">
            {limit.free}
          </strong>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-[62px] flex-none text-[0.62rem] font-extrabold uppercase tracking-[.1em] text-[var(--primary-strong)]">
            premium
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#27272a]">
            <span className="block h-full w-full rounded-full bg-[linear-gradient(90deg,#4ac7ff,#a184ff)]" />
          </span>
          <strong className="w-[52px] flex-none text-right text-[0.82rem]">
            {limit.premium}
          </strong>
        </div>
      </div>
    </div>
  );
}

function MethodRow({
  method,
  balance,
}: {
  method: PremiumPaymentMethod;
  balance: number;
}) {
  const Icon = METHOD_ICONS[method.kind] ?? CreditCard;
  return (
    <div className="border-b border-[var(--line)] px-4 py-3.5 last:border-0">
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 flex-none place-items-center rounded-full bg-[#17171d]"
          style={{ color: method.available ? "var(--stars)" : "var(--faint)" }}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong
              className={`text-[0.92rem] ${method.available ? "" : "text-[var(--muted)]"}`}
            >
              {method.title}
            </strong>
            {method.available ? (
              <span className="rounded-full bg-[#12231a] px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-[.1em] text-[var(--online)]">
                доступно
              </span>
            ) : (
              <span className="rounded-full bg-[#27272a] px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-[.1em] text-[var(--faint)]">
                скоро
              </span>
            )}
          </div>
          <p className="mb-0 mt-1 text-[0.82rem] leading-5 text-[var(--muted)]">
            {method.available && method.kind === "stars"
              ? `${method.subtitle} Баланс: ${balance} ★`
              : method.subtitle}
          </p>
          {method.badges.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {method.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full bg-[#17171d] px-2 py-1 text-[0.62rem] font-bold text-[var(--faint)]"
                >
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
