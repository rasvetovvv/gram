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
    .min(3, "Enter the recipient's username")
    .max(33, "Username is too long")
    .regex(/^@?[a-zA-Z][a-zA-Z0-9_]*$/, "Latin letters, digits and underscores"),
  amount: z
    .number({ error: "Enter the number of stars" })
    .int("Whole numbers only")
    .min(1, "At least 1 star")
    .max(1_000_000, "Amount is too large"),
  message: z.string().trim().max(160, "No more than 160 characters").optional()
});

export type SendStarsForm = z.infer<typeof sendSchema>;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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
      title="Send stars"
      description="The transfer reaches the recipient instantly and is saved in the history of both accounts"
      headerRight={
        <button
          type="button"
          className="icon-button !size-8 text-[var(--muted)]"
          aria-label="Close"
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
      form.setError("amount", { type: "validate", message: "Not enough stars on your balance" });
      return;
    }
    onSubmit(values);
  }

  return (
    <>
      <div className={styles.sheetHeading}>
        <p>Send stars</p>
      </div>
      <p className={styles.rowSubtitle} style={{ whiteSpace: "normal" }}>
        The transfer reaches the recipient instantly and is saved in the history of both accounts.
      </p>

      <form className={styles.form} onSubmit={form.handleSubmit(submit)}>
        <label className={styles.field}>
          <span>Recipient</span>
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
          <span>Amount</span>
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
            Message <i>optional</i>
          </span>
          <textarea
            className={styles.messageInput}
            rows={3}
            placeholder="For a great post"
            aria-invalid={Boolean(form.formState.errors.message)}
            {...form.register("message")}
          />
          {form.formState.errors.message ? (
            <small role="alert">{form.formState.errors.message.message}</small>
          ) : null}
        </label>

        <div className={styles.sendSummary}>
          <span>Available now</span>
          <strong>{balance !== null ? `${formatNumber(balance)} ★` : "—"}</strong>
        </div>

        {errorMessage ? (
          <p className={styles.formError} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button className={styles.actionPrimary} type="submit" disabled={pending}>
          <Send size={18} /> {pending ? "Sending…" : "Send stars"}
        </button>
      </form>
    </>
  );
}
