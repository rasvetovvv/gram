"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api, isEmailAuthChallenge } from "@/lib/api";
import { rememberAccount } from "@/lib/accounts";
import type { AuthSession, EmailAuthChallenge } from "@/lib/types";
import { useAuthStore } from "@/store/auth";

import { AuthShell } from "./auth-shell";
import { EmailCodeStep } from "./email-code-step";
import styles from "./auth.module.css";
import { FormNotice, PasswordField, SubmitButton, TextField } from "./form-controls";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .min(5, "Enter your email")
    .max(254, "Address is too long")
    .email("Check your email address"),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .max(128, "Password is too long"),
  accepted: z.boolean().refine(Boolean, "Accept the terms and privacy policy")
});

type RegisterValues = z.infer<typeof registerSchema>;

function registerError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "This email is already taken. Sign in or use a different one.";
  }
  return error instanceof Error ? error.message : "Couldn't create your account. Please try again.";
}

export function RegisterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const [challenge, setChallenge] = useState<EmailAuthChallenge | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", accepted: false },
    mode: "onBlur"
  });

  function finishRegistration(session: AuthSession) {
    setUser(session.user);
    rememberAccount(session.user);
    queryClient.setQueryData(["auth", "me"], session.user);
    queryClient.setQueryData(["me"], session.user);
    router.replace(session.user.onboarding_complete === false ? "/onboarding" : "/");
  }

  const register = useMutation({
    mutationFn: api.register,
    onSuccess: (result) => {
      if (isEmailAuthChallenge(result)) {
        setChallenge(result);
        return;
      }
      finishRegistration(result);
    }
  });

  if (challenge) {
    return (
      <AuthShell>
        <EmailCodeStep
          initial={challenge}
          onVerified={finishRegistration}
          onBack={() => {
            setChallenge(null);
            register.reset();
            form.setValue("password", "");
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <section aria-labelledby="register-title">
        <h1 className={styles.plainTitle} id="register-title">
          Sign up
        </h1>
        <p className={styles.plainSubtitle}>Create an account to get started</p>

        <form
          // `post`, so that if hydration has not finished the browser cannot submit the
          // password as a query string into the URL and the history.
          method="post"
          className={styles.plainForm}
          onSubmit={form.handleSubmit(({ email, password }) => register.mutate({ email, password }))}
          noValidate
        >
          {register.isError ? (
            <FormNotice kind="error">{registerError(register.error)}</FormNotice>
          ) : null}
          {register.isSuccess ? (
            <FormNotice kind="success">Account created. Just pick a username…</FormNotice>
          ) : null}

          <TextField
            label="Email"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            error={form.formState.errors.email?.message}
            {...form.register("email")}
          />
          <PasswordField
            label="Password"
            placeholder="••••••••••••"
            autoComplete="new-password"
            hint="At least 10 characters."
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />

          <label className={styles.termsConsent}>
            <input type="checkbox" {...form.register("accepted")} />
            <span>
              I accept the <Link href="/terms" target="_blank" rel="noreferrer">Terms of Use</Link> and{" "}
              <Link href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
            </span>
          </label>
          {form.formState.errors.accepted?.message ? (
            <p className={styles.fieldError} role="alert">
              {form.formState.errors.accepted.message}
            </p>
          ) : null}

          <SubmitButton
            className={styles.whiteButton}
            pending={register.isPending}
            pendingLabel="Creating…"
          >
            Create account
          </SubmitButton>
        </form>

        <p className={styles.plainSwitch}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </AuthShell>
  );
}
