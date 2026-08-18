"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, Send, Star, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BottomSheet } from "../ui/bottom-sheet";
import styles from "./stars.module.css";

const sendSchema = z.object({
  to_username: z
    .string()
    .trim()
    .min(3, "Введите юзернейм получателя")
    .max(33, "Юзернейм слишком длинный")
    .regex(/^@?[a-zA-Z][a-zA-Z0-9_]*$/, "Латиница, цифры и нижнее подчёркивание"),
  amount: z
    .number({ error: "Введите количество звёзд" })
    .int("Только целое количество")
    .min(1, "Минимум 1 звезда")
    .max(1_000_000, "Сумма слишком большая"),
  message: z.string().trim().max(160, "Не больше 160 символов").optional()
});

export type SendStarsForm = z.infer<typeof sendSchema>;

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

type FormProps = {
  initialRecipient: string;
  balance: number | null;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (values: SendStarsForm) => void;
};

/**
 * Transfers have no counterpart on the reference's Stars page, so this sheet borrows the
 * reference's sheet chrome and field metrics rather than a screen of its own.
 */
export function SendStarsSheet({
  open,
  onOpenChange,
  ...form
}: FormProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Отправить звёзды"
      description="Перевод сразу попадёт получателю и сохранится в истории обоих аккаунтов"
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
      {/* Unmounted while closed, so the draft clears itself between visits. */}
      <TransferForm {...form} />
    </BottomSheet>
  );
}

function TransferForm({
  initialRecipient,
  balance,
  pending,
  errorMessage,
  onSubmit
}: FormProps) {
  const form = useForm<SendStarsForm>({
    resolver: zodResolver(sendSchema),
    defaultValues: { to_username: initialRecipient, amount: 10, message: "" }
  });

  function submit(values: SendStarsForm) {
    // Checked here as well as server-side so the error lands on the field the user typed in.
    if (balance !== null && values.amount > balance) {
      form.setError("amount", { type: "validate", message: "Недостаточно звёзд на балансе" });
      return;
    }
    onSubmit(values);
  }

  return (
    <>
      <div className={styles.sheetHeading}>
        <p>Отправить звёзды</p>
      </div>
      <p className={styles.rowSubtitle} style={{ whiteSpace: "normal" }}>
        Перевод сразу попадёт получателю и сохранится в истории обоих аккаунтов.
      </p>

      <form className={styles.form} onSubmit={form.handleSubmit(submit)}>
        <label className={styles.field}>
          <span>Получатель</span>
          <span className={styles.textInput}>
            <AtSign size={18} />
            <input
              autoCapitalize="none"
              autoComplete="off"
              placeholder="username"
              aria-invalid={Boolean(form.formState.errors.to_username)}
              {...form.register("to_username")}
            />
          </span>
          {form.formState.errors.to_username ? (
            <small role="alert">{form.formState.errors.to_username.message}</small>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>Сумма</span>
          <span className={styles.amountInput}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1_000_000}
              aria-invalid={Boolean(form.formState.errors.amount)}
              {...form.register("amount", { valueAsNumber: true })}
            />
            <Star size={18} fill="currentColor" />
          </span>
          {form.formState.errors.amount ? (
            <small role="alert">{form.formState.errors.amount.message}</small>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>
            Сообщение <i>необязательно</i>
          </span>
          <textarea
            className={styles.messageInput}
            rows={3}
            placeholder="За отличный пост"
            aria-invalid={Boolean(form.formState.errors.message)}
            {...form.register("message")}
          />
          {form.formState.errors.message ? (
            <small role="alert">{form.formState.errors.message.message}</small>
          ) : null}
        </label>

        <div className={styles.sendSummary}>
          <span>Доступно сейчас</span>
          <strong>{balance !== null ? `${formatNumber(balance)} ★` : "—"}</strong>
        </div>

        {errorMessage ? (
          <p className={styles.formError} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button className={styles.actionPrimary} type="submit" disabled={pending}>
          <Send size={18} /> {pending ? "Отправляем…" : "Отправить звёзды"}
        </button>
      </form>
    </>
  );
}
