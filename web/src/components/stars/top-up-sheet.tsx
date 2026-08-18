"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Check, CreditCard, Star, Wallet, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BottomSheet } from "../ui/bottom-sheet";
import styles from "./stars.module.css";

/*
 * The reference offers exactly this ladder of packs, in this order, as a divided list in a
 * bottom sheet. It prices each row in UAH; GRAM has no pricing backend, so we show the
 * star amount alone rather than invent a tariff — a fabricated price would be the one
 * thing on this surface a user could act on and be wrong about.
 */
const PACKS = [100, 150, 250, 350, 500, 750, 1000, 1500, 2500, 5000, 10_000];

const CUSTOM_MIN = 10;
const CUSTOM_MAX = 10_000;

/* Bounds mirror the API: /api/stars/top-up accepts amount >= 10, and the ladder tops out
 * at 10 000, so the typed path and the packs can never disagree. */
const customAmountSchema = z.object({
  amount: z
    .number({ error: "Введите количество звёзд" })
    .int("Только целое количество")
    .min(CUSTOM_MIN, `Минимум ${CUSTOM_MIN} звёзд`)
    .max(CUSTOM_MAX, "Максимум 10 000 звёзд за раз")
});

type CustomAmountForm = z.infer<typeof customAmountSchema>;

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

type FlowProps = {
  balance: number | null;
  pending: boolean;
  errorMessage: string | null;
  onConfirm: (amount: number) => void;
};

export function TopUpSheet({
  open,
  onOpenChange,
  ...flow
}: FlowProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Пополнить баланс"
      description="Выберите количество звёзд и способ пополнения"
      headerRight={
        <button
          type="button"
          className="icon-button !size-8 text-[var(--muted)]"
          aria-label="Закрыть"
          onClick={() => onOpenChange(false)}
        >
          <X size={18} />
        </button>
      }
    >
      {/*
       * Radix unmounts sheet content on close, so the flow's step and selection reset by
       * construction — no effect has to chase the `open` prop back to a clean state.
       */}
      <TopUpFlow {...flow} />
    </BottomSheet>
  );
}

function TopUpFlow({ balance, pending, errorMessage, onConfirm }: FlowProps) {
  const [step, setStep] = useState<"amount" | "method">("amount");
  const [amount, setAmount] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const form = useForm<CustomAmountForm>({
    resolver: zodResolver(customAmountSchema),
    defaultValues: { amount: 100 }
  });

  function choose(next: number) {
    setAmount(next);
    setStep("method");
  }

  if (step === "amount") {
    return (
      <>
        <div className={styles.sheetHeading}>
          <p>Выберите количество</p>
        </div>

        <div className={styles.optionList}>
          {PACKS.map((pack) => (
            <button
              key={pack}
              type="button"
              className={styles.optionRow}
              onClick={() => choose(pack)}
            >
              <Star size={26} fill="currentColor" strokeWidth={1.4} />
              <span className={styles.optionLabel}>{formatNumber(pack)} звёзд</span>
              <span className={styles.optionTrail}>
                {amount === pack ? <Check size={18} className={styles.optionCheck} /> : null}
              </span>
            </button>
          ))}

          <button
            type="button"
            className={styles.optionRow}
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((value) => !value)}
          >
            <Star size={26} strokeWidth={1.4} />
            <span className={styles.optionLabel}>
              Другая сумма
              <span className={styles.optionMeta}>
                От {formatNumber(CUSTOM_MIN)} до {formatNumber(CUSTOM_MAX)} звёзд
              </span>
            </span>
          </button>
        </div>

        {customOpen ? (
          <form
            className={styles.form}
            onSubmit={form.handleSubmit((values) => choose(values.amount))}
          >
            <label className={styles.field}>
              <span>Количество</span>
              <span className={styles.amountInput}>
                <input
                  autoFocus
                  inputMode="numeric"
                  aria-invalid={Boolean(form.formState.errors.amount)}
                  {...form.register("amount", { valueAsNumber: true })}
                />
                <Star size={18} fill="currentColor" />
              </span>
              {form.formState.errors.amount ? (
                <small role="alert">{form.formState.errors.amount.message}</small>
              ) : null}
            </label>
            <button className={styles.actionPrimary} type="submit">
              Продолжить
            </button>
          </form>
        ) : null}

        <p className={styles.sheetNote}>
          Звёзды оплачивают подарки, подписки и коллекционные юзернеймы внутри GRAM.
        </p>
      </>
    );
  }

  return (
    <>
      <div className={styles.sheetHeading}>
        <p>Способ пополнения</p>
        <button type="button" className={styles.sheetBack} onClick={() => setStep("amount")}>
          <ArrowLeft size={15} /> Сумма
        </button>
      </div>

      <div className={styles.optionList}>
        <button
          type="button"
          className={styles.optionRow}
          disabled={pending}
          onClick={() => amount !== null && onConfirm(amount)}
        >
          <span className={styles.methodChip}>
            <Wallet size={19} />
          </span>
          <span className={styles.optionLabel}>
            Внутренний баланс аккаунта
            <span className={styles.optionMeta}>
              {pending ? "Зачисляем…" : "Зачисление сразу, без оплаты картой"}
            </span>
          </span>
          <span className={styles.optionTrail}>
            {amount !== null ? `${formatNumber(amount)} ★` : null}
          </span>
        </button>

        {/*
         * No processor is wired to GRAM yet, so this row states that plainly instead of
         * opening a form that could not charge anything. It stays visible because the method
         * belongs in the flow the moment the provider is connected.
         */}
        <button
          type="button"
          className={styles.optionRow}
          disabled
          title="Оплата картой станет доступна после подключения платёжного провайдера"
        >
          <span className={styles.methodChip}>
            <CreditCard size={19} />
          </span>
          <span className={styles.optionLabel}>
            Банковская карта
            <span className={styles.optionMeta}>Списание с карты и чек по операции</span>
          </span>
          <span className={styles.pendingBadge}>Ожидает подключения</span>
        </button>
      </div>

      {errorMessage ? (
        <p className={styles.formError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <p className={styles.sheetNote}>
        Оплата картой заработает после подключения платёжного провайдера. Сейчас доступно только
        зачисление с внутреннего баланса аккаунта — оно попадает в историю операций наравне с
        остальными.
        {balance !== null ? (
          <>
            {" "}
            Текущий баланс — <strong>{formatNumber(balance)} ★</strong>.
          </>
        ) : null}
      </p>
    </>
  );
}
