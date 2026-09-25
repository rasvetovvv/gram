"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api, isEmailAuthChallenge } from "@/lib/api";
import { listAccounts, rememberAccount } from "@/lib/accounts";
import type { AuthSession, EmailAuthChallenge } from "@/lib/types";
import { useAuthStore } from "@/store/auth";

import { AccountSwitcher } from "./account-switcher";
import { AuthShell } from "./auth-shell";
import { EmailCodeStep } from "./email-code-step";
import { INTRO_KEY } from "./welcome-carousel";
import styles from "./auth.module.css";
import { FormNotice, PasswordField, SubmitButton, TextField } from "./form-controls";

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your email or username").max(254, "That value is too long"),
  password: z.string().min(1, "Enter your password").max(128, "Password is too long")
});

type LoginValues = z.infer<typeof loginSchema>;

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function loginError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Your email, username, or password didn't match. Check your details and try again.";
  }
  if (error instanceof ApiError && error.status === 429) {
    return "Too many attempts. Wait a moment and try again.";
  }
  return error instanceof Error ? error.message : "Couldn't sign in. Please try again.";
}

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  // Switching accounts lands here with the handle already chosen, so only the password is left.
  const prefill = searchParams.get("identifier") ?? "";
  const [challenge, setChallenge] = useState<EmailAuthChallenge | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: prefill, password: "" },
    mode: "onBlur"
  });

  /**
   * A browser that has never seen the intro and has no remembered account is a first visit,
   * so it gets the three slides once — the way the reference opens.
   */
  useEffect(() => {
    if (prefill || searchParams.get("next")) return;
    try {
      if (window.localStorage.getItem(INTRO_KEY)) return;
      if (listAccounts().length) return;
    } catch {
      return;
    }
    router.replace("/welcome");
  }, [prefill, router, searchParams]);

  function finishLogin(session: AuthSession) {
    setUser(session.user);
    rememberAccount(session.user);
    queryClient.setQueryData(["auth", "me"], session.user);
    queryClient.setQueryData(["me"], session.user);
    router.replace(
      session.user.onboarding_complete === false
        ? "/onboarding"
        : safeNext(searchParams.get("next"))
    );
  }

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (result) => {
      if (isEmailAuthChallenge(result)) {
        setChallenge(result);
        return;
      }
      finishLogin(result);
    }
  });

  if (challenge) {
    return (
      <AuthShell>
        <EmailCodeStep
          initial={challenge}
          onVerified={finishLogin}
          onBack={() => {
            setChallenge(null);
            login.reset();
            form.setValue("password", "");
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <section aria-labelledby="login-title">
        <h1 className={styles.plainTitle} id="login-title">
          Sign in
        </h1>
        <p className={styles.plainSubtitle}>Enter your details</p>

        <form
          // `post`, so that if hydration has not finished the browser cannot submit the
          // password as a query string into the URL and the history.
          method="post"
          className={styles.plainForm}
          onSubmit={form.handleSubmit((values) => login.mutate(values))}
          noValidate
        >
          {login.isError ? <FormNotice kind="error">{loginError(login.error)}</FormNotice> : null}
          {login.isSuccess ? <FormNotice kind="success">Signed in. Opening GRAM…</FormNotice> : null}

          <TextField
            label="Email or username"
            placeholder="name@example.com"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            error={form.formState.errors.identifier?.message}
            {...form.register("identifier")}
          />
          <PasswordField
            label="Password"
            placeholder="••••••••••••"
            autoComplete="current-password"
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />

          <Link className={styles.rightLink} href="/login/recover">
            Forgot your password?
          </Link>

          <SubmitButton className={styles.whiteButton} pending={login.isPending} pendingLabel="Signing in…">
            Sign in
          </SubmitButton>

          {/* The reference offers a QR sign-in beside the password one; ours says what it is
              rather than opening a scanner that has nothing to talk to yet. */}
          <Link className={styles.ghostButton} href="/login/qr">
            <QrCode size={20} />
            Sign in with a QR code
          </Link>
        </form>

        <p className={styles.plainSwitch}>
          Don&apos;t have an account yet? <Link href="/register">Create an account</Link>
        </p>

        {/* Accounts this browser has used before: one tap fills the handle in. */}
        <div style={{ marginTop: 26 }}>
          <AccountSwitcher variant="login" />
        </div>
      </section>
    </AuthShell>
  );
}
