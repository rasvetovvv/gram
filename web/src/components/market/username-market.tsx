"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AtSign, BadgeCheck, Copy, Gavel, History, Search, ShieldCheck, Sparkles, Star, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import type { UsernameAsset } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";

const reserveSchema = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{3,31}$/, "4–32 символа: латиница, цифры и _") });
const listingSchema = z.object({ price: z.coerce.number().int().min(10, "Минимум 10 звёзд").max(1_000_000) });

export function UsernameMarket() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"all" | "mine" | "listed">("all");
  const [result, setResult] = useState("");
  const form = useForm<z.infer<typeof reserveSchema>>({ resolver: zodResolver(reserveSchema), defaultValues: { username: "" } });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["usernames"], queryFn: api.usernames });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const mine = items.filter((item) => item.owner_username === me?.username);
  const visible = scope === "mine" ? mine : scope === "listed" ? items.filter((item) => item.status === "listed") : items;
  const reserve = useMutation({ mutationFn: ({ username }: z.infer<typeof reserveSchema>) => api.reserveUsername(username), onSuccess: async (asset) => { setResult(`@${asset.username} закреплён за вашим аккаунтом`); form.reset(); await Promise.all([queryClient.invalidateQueries({ queryKey: ["usernames"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]); }, onError: () => setResult("") });

  return <>
    <div className="mobile-topbar"><span className="wordmark">ЮЗЕРНЕЙМЫ</span><Sparkles size={20} className="text-[var(--stars)]" /></div>
    <section className="relative overflow-hidden px-4 pb-7 pt-8 sm:px-6 sm:pt-11"><div className="absolute -right-10 -top-8 size-56 rounded-full bg-[#203648] opacity-45 blur-3xl" /><div className="relative"><h1 className="channel-title max-w-[560px]">Имя, которое принадлежит вам</h1><p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--muted)]">Проверьте свободный @юзернейм, закрепите его за аккаунтом или купите выставленное имя за Stars. Каждая смена владельца остаётся в истории.</p><form className="mt-6 flex items-start gap-2" onSubmit={form.handleSubmit((values) => reserve.mutate(values))}><div className="min-w-0 flex-1"><label className="field flex items-center px-4"><span className="mr-1 font-bold text-[var(--link)]">@</span><input autoCapitalize="none" autoCorrect="off" className="min-w-0 flex-1 bg-transparent outline-none" placeholder="ваш_юзернейм" {...form.register("username")} /><Search size={18} className="text-[var(--faint)]" /></label><p className="mb-0 mt-2 min-h-5 text-xs text-[var(--danger)]">{form.formState.errors.username?.message ?? reserve.error?.message}</p></div><button className="signal-button h-12" disabled={reserve.isPending}>{reserve.isPending ? "Проверяем…" : "Занять"}</button></form>{result ? <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2 text-sm text-[var(--online)]"><BadgeCheck size={17} />{result}</motion.div> : null}</div></section>

    <div className="mx-3 grid grid-cols-3 overflow-hidden rounded-[22px] bg-[#121216] text-center text-xs text-[var(--muted)] sm:mx-5"><div className="py-4"><strong className="block text-lg text-white">{mine.length}</strong>ваших</div><div className="border-x border-[var(--line)] py-4"><strong className="block text-lg text-white">{items.filter((item) => item.status === "listed").length}</strong>на продаже</div><div className="py-4"><strong className="block text-lg text-[var(--stars)]">{me?.stars_balance ?? 0} ★</strong>баланс</div></div>
    <div className="px-3 py-4 sm:px-5"><div className="segmented-control">{[{ value: "all" as const, label: "Все" }, { value: "mine" as const, label: "Мои" }, { value: "listed" as const, label: "На продаже" }].map((tab) => <button key={tab.value} data-active={scope === tab.value} onClick={() => setScope(tab.value)}>{tab.label}</button>)}</div></div>
    <AssetList items={visible} loading={isLoading} me={me?.username} />
  </>;
}

function AssetList({ items, loading, me }: { items: UsernameAsset[]; loading: boolean; me?: string }) {
  if (loading) return <div className="space-y-2 px-3 sm:px-5">{[0,1,2].map((i) => <div key={i} className="skeleton h-20 rounded-[20px]" />)}</div>;
  if (!items.length) return <div className="empty-state"><AtSign className="mx-auto mb-3" /><p>В этом разделе пока ничего нет</p></div>;
  return <div className="space-y-2 px-3 pb-8 sm:px-5">{items.map((item, index) => <AssetRow key={item.id} item={item} index={index} mine={item.owner_username === me} />)}</div>;
}

function AssetRow({ item, index, mine }: { item: UsernameAsset; index: number; mine: boolean }) {
  const [open, setOpen] = useState(false);
  const statusLabel = mine ? "Ваш" : item.status === "listed" ? `${item.price ?? 0} ★` : item.status === "available" ? "Свободен" : "Зарезервирован";
  return <><motion.button type="button" onClick={() => setOpen(true)} id={`username-${item.username}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .15) }} className="surface flex min-h-20 w-full scroll-mt-4 items-center gap-3 border-0 p-3.5 text-left hover:bg-[#17171d]"><span className="grid size-12 flex-none place-items-center rounded-[16px] bg-[#17171d] text-lg font-black text-[var(--link)]">@</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate">@{item.username}</strong>{item.rarity === "founder" ? <span className="rounded-full bg-[#342813] px-2 py-0.5 text-[0.58rem] font-extrabold text-[var(--stars)]">FOUNDER</span> : null}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{item.owner_username ? `Владелец @${item.owner_username}` : "Нет владельца"} · {item.offers_count ?? 0} предложений</span></span><span className={mine ? "text-sm font-bold text-[var(--link)]" : item.status === "available" ? "text-sm font-bold text-[var(--online)]" : "text-sm font-bold text-[var(--stars)]"}>{statusLabel}</span></motion.button><AssetDialog item={item} mine={mine} close={() => setOpen(false)} open={open} /></>;
}

function AssetDialog({ item, mine, close, open }: { item: UsernameAsset; mine: boolean; close: () => void; open: boolean }) {
  const queryClient = useQueryClient();
  const [confirmPurchase, setConfirmPurchase] = useState(false);
  const [feedback, setFeedback] = useState("");
  const history = useQuery({ queryKey: ["username-history", item.id], queryFn: () => api.usernameHistory(item.id), enabled: open });
  const form = useForm<z.input<typeof listingSchema>, unknown, z.output<typeof listingSchema>>({ resolver: zodResolver(listingSchema), defaultValues: { price: item.price ?? 250 } });
  const listing = useMutation({ mutationFn: ({ price }: z.output<typeof listingSchema>) => api.updateListing(item.id, true, price), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["usernames"] }); setFeedback("Юзернейм выставлен на продажу"); } });
  const purchase = useMutation({ mutationFn: () => api.purchaseUsername(item.id), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["usernames"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]); close(); } });
  async function copy(value: string, message: string) { await navigator.clipboard.writeText(value); setFeedback(message); }
  return <BottomSheet
    open={open}
    onOpenChange={(next) => { if (!next) close(); }}
    title={`@${item.username}`}
    description={`Коллекционный юзернейм · ${item.rarity}`}
    headerRight={<Dialog.Close className="icon-button !size-9 bg-[#27272a]" aria-label="Закрыть"><X size={18} /></Dialog.Close>}
  ><div className="pt-1"><h2 className="m-0 text-2xl font-extrabold tracking-[-0.03em] text-[var(--link)]">@{item.username}</h2><p className="mb-0 mt-1 text-sm text-[var(--muted)]">Коллекционный юзернейм · {item.rarity}</p></div><div className="pt-4"><div className="overflow-hidden rounded-[20px] bg-[#27272a]"><div className="flex min-h-13 items-center border-b border-[var(--line)] px-4"><span className="w-28 text-sm text-[var(--muted)]">Владелец</span><strong className="text-sm">{item.owner_username ? `@${item.owner_username}` : "Нет владельца"}</strong></div><div className="flex min-h-13 items-center border-b border-[var(--line)] px-4"><span className="w-28 text-sm text-[var(--muted)]">Получен</span><strong className="text-sm">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.acquired_at))}</strong></div><div className="flex min-h-13 items-center px-4"><span className="w-28 text-sm text-[var(--muted)]">Статус</span><strong className="text-sm">{mine ? "Ваш" : item.status === "listed" ? `На продаже · ${item.price ?? 0} ★` : item.status === "available" ? "Свободен" : "Зарезервирован"}</strong></div></div><div className="mt-3 grid grid-cols-2 gap-2"><button className="quiet-button !px-3" onClick={() => copy(`@${item.username}`, "Юзернейм скопирован")}><Copy size={17} />Скопировать</button><button className="quiet-button !px-3" onClick={() => copy(`${window.location.origin}/market#username-${item.username}`, "Ссылка скопирована")}><AtSign size={17} />Ссылка</button></div><section className="mt-5"><h3 className="m-0 text-base font-bold">История владения</h3><div className="mt-3 space-y-2">{history.isLoading ? <div className="skeleton h-14 rounded-[18px]" /> : history.data?.map((event) => <div key={event.id} className="flex items-center gap-3 rounded-[18px] bg-[#27272a] p-3"><span className="grid size-9 place-items-center rounded-full bg-[#27272a] text-[var(--primary-strong)]"><History size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{event.action === "purchased" ? "Покупка" : event.action === "listed" ? "Выставлен на продажу" : event.action === "transferred" ? "Передача" : "Закреплён"}</strong><span className="block truncate text-xs text-[var(--muted)]">{event.to_user ? `@${event.to_user.username}` : "GRAM"} · {relativeTime(event.created_at)}</span></span>{event.price_stars ? <span className="text-xs font-bold text-[var(--stars)]">{event.price_stars} ★</span> : null}</div>)}</div></section>{mine ? <form className="mt-5 rounded-[22px] bg-[#27272a] p-4" onSubmit={form.handleSubmit((values) => listing.mutate(values))}><h3 className="m-0 text-base font-bold">Выставить на продажу</h3><p className="mb-0 mt-1 text-sm text-[var(--muted)]">Владение перейдёт покупателю только после атомарной оплаты.</p><label className="field mt-3 flex items-center gap-2 px-3"><Star size={17} className="text-[var(--stars)]" fill="currentColor" /><input type="number" className="min-w-0 flex-1 bg-transparent outline-none" {...form.register("price")} /></label><p className="min-h-5 text-xs text-[var(--danger)]">{form.formState.errors.price?.message ?? listing.error?.message}</p><button className="gold-button w-full" disabled={listing.isPending}><Gavel size={17} />{listing.isPending ? "Публикуем…" : "Начать продажу"}</button></form> : item.status === "listed" ? <div className="mt-5">{confirmPurchase ? <div className="rounded-[22px] bg-[#2b2024] p-4"><p className="m-0 text-sm leading-5">Купить <strong>@{item.username}</strong> за <strong>{item.price ?? 0} ★</strong>? Имя сразу перейдёт в ваш профиль.</p><div className="mt-3 flex gap-2"><button className="quiet-button flex-1" onClick={() => setConfirmPurchase(false)}>Назад</button><button className="gold-button flex-1" onClick={() => purchase.mutate()} disabled={purchase.isPending}>{purchase.isPending ? "Покупаем…" : "Подтвердить"}</button></div></div> : <button className="gold-button w-full" onClick={() => setConfirmPurchase(true)}><Star size={17} fill="currentColor" />Купить за {item.price ?? 0} ★</button>}<p className="min-h-5 text-xs text-[var(--danger)]">{purchase.error?.message}</p></div> : null}<p className="mb-0 mt-3 min-h-5 text-center text-sm text-[var(--online)]" aria-live="polite">{feedback}</p><div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={16} className="text-[var(--online)]" />Смена владельца фиксируется в истории</div></div></BottomSheet>;
}
