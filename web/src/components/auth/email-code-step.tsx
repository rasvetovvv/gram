"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, MailCheck, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import type { AuthSession, EmailAuthChallenge } from "@/lib/types";

import styles from "./auth.module.css";
import { FormNotice, SubmitButton, TextField } from "./form-controls";

function codeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return "That code doesn't match. Check the six digits and try again.";
    if (error.status === 410) return "The code has expired. Request a new one.";
    if (error.status === 429) return error.message;
    if (error.status === 409) return "This code has already been used. Start signing in again.";
  }
  return error instanceof Error ? error.message : "Couldn't verify the code.";
}

export function EmailCodeStep({
  initial,
  onVerified,
  onBack
}: {
  initial: EmailAuthChallenge;
  onVerified: (session: AuthSession) => void;
  onBack: () => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(initial.resend_after);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [challenge.challenge_id, challenge.resend_after]);

  const verify = useMutation({
    mutationFn: () => api.verifyEmailCode(challenge.challenge_id, code),
    onSuccess: onVerified
  });
  const resend = useMutation({
    mutationFn: () => api.resendEmailCode(challenge.challenge_id),
    onSuccess: (next) => {
      setChallenge(next);
      setCode("");
      setSeconds(next.resend_after);
    }
  });

  const registration = challenge.purpose === "register";
  const pending = verify.isPending || resend.isPending;

  return (
    <section aria-labelledby="email-code-title">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-[18px] bg-[var(--auth-surface-raised)] text-[var(--auth-violet)]">
        <MailCheck size={25} />
      </span>
      <h1 className={styles.plainTitle} id="email-code-title">
        {registration ? "Confirm your email" : "Sign-in code"}
      </h1>
      <p className={styles.plainSubtitle}>
        We sent six digits to <strong className="text-[var(--auth-text)]">{challenge.masked_email}</strong>
      </p>

      <form
        method="post"
        className={styles.plainForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (/^\d{6}$/.test(code)) verify.mutate();
        }}
        noValidate
      >
        {challenge.delivery === "failed" ? (
          <FormNotice kind="error">The email didn&apos;t send. Check your connection and request the code again.</FormNotice>
        ) : null}
        {verify.isError ? <FormNotice kind="error">{codeError(verify.error)}</FormNotice> : null}
        {resend.isError ? <FormNotice kind="error">{codeError(resend.error)}</FormNotice> : null}
        {resend.isSuccess ? <FormNotice kind="success">A new code has been sent. The previous one no longer works.</FormNotice> : null}

        <TextField
          label="Code from the email"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          className="text-center !text-[1.35rem] !font-black !tracking-[0.32em]"
          hint="The code is valid for 10 minutes and can be used only once."
        />

        <SubmitButton
          className={styles.whiteButton}
          pending={verify.isPending}
          pendingLabel="Verifying…"
        >
          {registration ? "Confirm and create account" : "Confirm sign-in"}
        </SubmitButton>

        <button
          type="button"
          className={styles.ghostButton}
          disabled={pending || seconds > 0}
          onClick={() => resend.mutate()}
        >
          <RefreshCw size={18} className={resend.isPending ? styles.spin : undefined} />
          {seconds > 0 ? `Resend in ${seconds} sec.` : "Send a new code"}
        </button>
        <button type="button" className={`${styles.rightLink} inline-flex items-center gap-1.5`} onClick={onBack} disabled={pending}>
          <ArrowLeft size={16} />
          {registration ? "Change email" : "Back to password"}
        </button>
      </form>
    </section>
  );
}