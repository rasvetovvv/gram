"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { forwardRef, useState } from "react";

import styles from "./auth.module.css";

type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, id, type = "text", className, ...props },
  ref
) {
  const inputId = id ?? props.name;
  const descriptionId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <label className={styles.field} htmlFor={inputId}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        {...props}
        ref={ref}
        id={inputId}
        type={type}
        className={`${styles.input} ${error ? styles.inputError : ""} ${className ?? ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
      />
      {error ? <span className={styles.fieldError} id={descriptionId}>{error}</span> : null}
      {!error && hint ? <span className={styles.fieldHint} id={descriptionId}>{hint}</span> : null}
    </label>
  );
});

type PasswordFieldProps = Omit<TextFieldProps, "type">;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, error, hint, id, className, ...props },
  ref
) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? props.name;
  const descriptionId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <label className={styles.field} htmlFor={inputId}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.passwordWrap}>
        <input
          {...props}
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          className={`${styles.input} ${styles.passwordInput} ${error ? styles.inputError : ""} ${className ?? ""}`}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionId}
        />
        <button
          className={styles.passwordToggle}
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </span>
      {error ? <span className={styles.fieldError} id={descriptionId}>{error}</span> : null}
      {!error && hint ? <span className={styles.fieldHint} id={descriptionId}>{hint}</span> : null}
    </label>
  );
});

export function FormNotice({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  const Icon = kind === "error" ? AlertCircle : CheckCircle2;
  return (
    <div className={`${styles.notice} ${kind === "success" ? styles.noticeSuccess : styles.noticeError}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={18} />
      <span>{children}</span>
    </div>
  );
}

export function SubmitButton({
  pending,
  pendingLabel = "Saving…",
  className,
  children
}: {
  pending: boolean;
  pendingLabel?: string;
  /** Lets a screen swap in the reference's white action without a second component. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button className={className ?? styles.primaryButton} type="submit" disabled={pending}>
      {pending ? <LoaderCircle className={styles.spin} size={19} /> : null}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
