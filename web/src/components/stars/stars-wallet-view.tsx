"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChartColumn,
  Check,
  ChevronDown,
  Plus,
  RotateCcw,
  Send,
  Star,
  X
} from "lucide-react";
import { useEffect, useRef, useMemo, useState } from "react";
import { socialApi } from "@/lib/social-api";
import type { StarTransaction } from "@/lib/social-types";
import { SendStarsSheet, type SendStarsForm } from "./send-stars-sheet";
import styles from "./stars.module.css";
import { TopUpSheet } from "./top-up-sheet";

type LedgerFilter = "all" | "credit" | "spend";

const filterLabels: Record<LedgerFilter, string> = {
  all: "Все операции",
  credit: "Зачисления",
  spend: "Списания"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const KIND_LABELS: Record<string, string> = {
  welcome: "стартовый баланс",
  top_up: "пополнения",
  transfer_sent: "переводы",
  transfer_received: "полученные переводы",
  subscription: "подписки авторам",
  premium_purchase: "GRAM Premium",
  gift_purchase: "подарки",
  gift_sale: "продажу подарков",
  username_purchase: "коллекционные юзернеймы",
  username_sale: "продажу юзернеймов",
  refund: "возвраты"
};

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function transactionMeta(transaction: StarTransaction) {
  if (transaction.kind === "refund") {
    return { label: "Возврат", icon: RotateCcw, tone: styles.refund };
  }
  if (transaction.amount >= 0) {
    return { label: "Зачисление", icon: ArrowDownLeft, tone: styles.credit };
  }
  return { label: "Списание", icon: ArrowUpRight, tone: styles.spend };
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить данные";
}

export function StarsWalletView({ initialRecipient = "" }: { initialRecipient?: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  /* The transfer form remounts with the sheet, so the ?to= recipient is held here and
   * dropped after the first visit — otherwise every later open would re-prefill it. */
  const [prefill, setPrefill] = useState(initialRecipient);
  const queryRecipientHandled = useRef(false);

  const wallet = useQuery({ queryKey: ["stars", "wallet"], queryFn: socialApi.starsWallet });
  const transactions = useQuery({
    queryKey: ["stars", "transactions"],
    queryFn: socialApi.starTransactions
  });

  useEffect(() => {
    if (!initialRecipient || queryRecipientHandled.current) return;
    queryRecipientHandled.current = true;
    setSendOpen(true);
  }, [initialRecipient]);

  /* The dock and the gift sheet read the balance from ["me"], so a credit here has to
   * invalidate that cache too or those surfaces keep showing the old number. */
  async function refreshBalanceConsumers() {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  const topUp = useMutation({
    mutationFn: (amount: number) => socialApi.topUpStars(amount),
    onSuccess: async (nextWallet, amount) => {
      queryClient.setQueryData(["stars", "wallet"], nextWallet);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stars", "transactions"] }),
        refreshBalanceConsumers()
      ]);
      setNotice(`Баланс пополнен на ${formatNumber(amount)} ★`);
      setTopUpOpen(false);
    }
  });

  const sendStars = useMutation({
    mutationFn: ({ to_username, amount, message }: SendStarsForm) =>
      socialApi.sendStars(to_username, amount, message),
    onSuccess: async (receipt) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stars", "wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["stars", "transactions"] }),
        refreshBalanceConsumers()
      ]);
      setNotice(`Отправлено ${formatNumber(receipt.amount)} ★ пользователю @${receipt.recipient.username}`);
      setSendOpen(false);
    }
  });

  const filteredTransactions = useMemo(() => {
    const items = transactions.data ?? [];
    // Refunds are credits, so they belong to «Зачисления» rather than a tab of their own.
    if (filter === "credit") return items.filter((item) => item.amount > 0);
    if (filter === "spend") return items.filter((item) => item.amount < 0);
    return items;
  }, [filter, transactions.data]);

  const ledgerStats = useMemo(() => {
    const items = transactions.data ?? [];
    const sum = (list: typeof items) =>
      list.reduce((total, item) => total + Math.abs(item.amount), 0);
    const spent = items.filter((item) => item.amount < 0);
    const byKind = new Map<string, number>();
    for (const item of spent) {
      byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + Math.abs(item.amount));
    }
    const top = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      operations: items.length,
      credited: sum(items.filter((item) => item.amount > 0)),
      spent: sum(spent),
      topKind: top ? { kind: top[0], amount: top[1] } : null
    };
  }, [transactions.data]);

  const balance = wallet.data?.balance ?? null;

  return (
    <div className={styles.page}>
      <div className="mobile-topbar">
        <span className="wordmark">ЗВЁЗДЫ</span>
        <Star size={20} className="text-[var(--stars)]" fill="currentColor" />
      </div>

      {/*
       * The reference leads with a centred hero — artwork, title, one line of copy — instead
       * of the wide page header GRAM uses elsewhere, and repeats the title in a sticky bar.
       * Here the bar is mobile-only (it is hidden ≥900px by the shell), so the hero carries
       * the page heading on desktop and nothing is duplicated.
       */}
      <header className={styles.hero}>
        <span className={styles.heroStar} aria-hidden="true">
          <Star size={72} strokeWidth={1.1} fill="currentColor" />
        </span>
        <h1>Звёзды GRAM</h1>
        <p>Звёзды нужны для оплаты контента, подарков и услуг внутри GRAM.</p>
      </header>

      {notice ? (
        <button className={styles.notice} type="button" onClick={() => setNotice(null)}>
          <span>
            <Check size={17} /> {notice}
          </span>
          <X size={16} aria-label="Скрыть уведомление" />
        </button>
      ) : null}

      <section className={styles.balanceCard} aria-labelledby="stars-balance-title">
        <div className={styles.balanceValue}>
          {wallet.isPending ? (
            <span className={styles.balanceSkeleton} aria-label="Баланс загружается" />
          ) : wallet.isError ? (
            <button className={styles.retryLink} type="button" onClick={() => wallet.refetch()}>
              Повторить загрузку
            </button>
          ) : (
            <>
              <Star size={26} fill="currentColor" strokeWidth={1.4} aria-hidden="true" />
              {formatNumber(wallet.data.balance)}
            </>
          )}
        </div>
        <p className={styles.balanceCaption} id="stars-balance-title">
          Ваш баланс
        </p>

        <div className={styles.balanceActions}>
          <button className={styles.actionPrimary} type="button" onClick={() => setTopUpOpen(true)}>
            <Plus size={19} /> Пополнить
          </button>
          <button className={styles.actionSecondary} type="button" onClick={() => setSendOpen(true)}>
            <Send size={18} /> Отправить
          </button>
        </div>

        <button
          className={styles.disclosure}
          type="button"
          onClick={() => setStatsOpen((open) => !open)}
          aria-expanded={statsOpen}
          aria-controls="stars-statistics"
        >
          <ChartColumn size={17} />
          Статистика
          <ChevronDown
            size={16}
            style={{
              transform: statsOpen ? "rotate(180deg)" : undefined,
              transition: "transform var(--dur-base) var(--ease-out)"
            }}
          />
        </button>
      </section>

      {statsOpen ? (
        <section className={styles.card} id="stars-statistics">
          <p className={styles.rowTitle}>Статистика операций</p>
          <dl className={styles.statGrid}>
            <div>
              <dt>Зачислено</dt>
              <dd style={{ color: "var(--online)" }}>+{formatNumber(ledgerStats.credited)} ★</dd>
            </div>
            <div>
              <dt>Списано</dt>
              <dd style={{ color: "var(--stars)" }}>−{formatNumber(ledgerStats.spent)} ★</dd>
            </div>
            <div>
              <dt>Операций</dt>
              <dd>{formatNumber(ledgerStats.operations)}</dd>
            </div>
          </dl>
          {ledgerStats.topKind ? (
            <p className={styles.rowSubtitle} style={{ marginTop: 10, whiteSpace: "normal" }}>
              Больше всего уходит на {kindLabel(ledgerStats.topKind.kind)} —{" "}
              {formatNumber(ledgerStats.topKind.amount)} ★
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card}>
        <div className="flex items-center gap-3">
          <span className={styles.telegramChip}>
            <Send size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={styles.rowTitle}>Telegram-бот</p>
            <p className={styles.rowSubtitle}>Покупка звёзд и Premium прямо в Telegram</p>
          </div>
          {/* Nothing links a GRAM account to Telegram yet, so the control says so plainly. */}
          <button
            className={styles.rowAction}
            type="button"
            disabled
            title="Привязка Telegram появится позже"
          >
            Скоро
          </button>
        </div>
      </section>

      <section className={styles.ledger} aria-labelledby="ledger-title">
        <h2 id="ledger-title" className="sr-only">
          История операций
        </h2>

        <div className={styles.tabs} role="tablist" aria-label="Фильтр операций">
          {(Object.keys(filterLabels) as LedgerFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              aria-controls="ledger-panel"
              data-active={filter === key}
              onClick={() => setFilter(key)}
            >
              {filterLabels[key]}
              {filter === key ? <span className={styles.tabUnderline} aria-hidden="true" /> : null}
            </button>
          ))}
          {wallet.data ? (
            <span className={styles.updatedAt}>Обновлено {formatDate(wallet.data.updated_at)}</span>
          ) : null}
        </div>

        <div className={styles.ledgerBody} id="ledger-panel" role="tabpanel">
          {transactions.isPending ? (
            <div className={styles.ledgerLoading} aria-label="История загружается">
              <span />
              <span />
              <span />
            </div>
          ) : transactions.isError ? (
            <div className={styles.emptyState}>
              <span>
                <Star size={26} />
              </span>
              <strong>История не загрузилась</strong>
              <p>{messageFrom(transactions.error)}</p>
              <button type="button" onClick={() => transactions.refetch()}>
                Попробовать снова
              </button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className={styles.emptyState}>
              <span>
                <Star size={26} />
              </span>
              <strong>{filter === "all" ? "Пока нет операций" : "Нет операций в этом разделе"}</strong>
              <p>Пополнения и траты появятся здесь с итоговым балансом.</p>
            </div>
          ) : (
            <ul className={styles.transactionList}>
              {filteredTransactions.map((transaction) => {
                const meta = transactionMeta(transaction);
                const Icon = meta.icon;
                return (
                  <li key={transaction.id}>
                    <span className={`${styles.transactionIcon} ${meta.tone}`}>
                      <Icon size={19} />
                    </span>
                    <span className={styles.transactionCopy}>
                      <strong>{transaction.description}</strong>
                      <small>
                        {meta.label} · {formatDate(transaction.created_at)}
                        {transaction.counterparty ? ` · @${transaction.counterparty.username}` : ""}
                      </small>
                    </span>
                    <span
                      className={
                        transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount
                      }
                    >
                      {transaction.amount > 0 ? "+" : ""}
                      {formatNumber(transaction.amount)} ★
                      <small>Баланс {formatNumber(transaction.balance_after)}</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <TopUpSheet
        open={topUpOpen}
        onOpenChange={(open) => {
          setTopUpOpen(open);
          if (!open) topUp.reset();
        }}
        balance={balance}
        pending={topUp.isPending}
        errorMessage={topUp.isError ? messageFrom(topUp.error) : null}
        onConfirm={(amount) => topUp.mutate(amount)}
      />

      <SendStarsSheet
        open={sendOpen}
        onOpenChange={(open) => {
          setSendOpen(open);
          if (!open) {
            sendStars.reset();
            setPrefill("");
          }
        }}
        initialRecipient={prefill}
        balance={balance}
        pending={sendStars.isPending || wallet.isPending}
        errorMessage={sendStars.isError ? messageFrom(sendStars.error) : null}
        onSubmit={(values) => sendStars.mutate(values)}
      />
    </div>
  );
}
