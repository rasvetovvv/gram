"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
import { listAccounts, rememberAccount } from "@/lib/accounts";
import { useAuthStore } from "@/store/auth";

import { AccountSwitcher } from "./account-switcher";
import { AuthShell } from "./auth-shell";
import { INTRO_KEY } from "./welcome-carousel";
import styles from "./auth.module.css";
import { FormNotice, PasswordField, SubmitButton, TextField } from "./form-controls";

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Введите почту или юзернейм").max(254, "Слишком длинное значение"),
  password: z.string().min(1, "Введите пароль").max(128, "Пароль слишком длинный")
});

type LoginValues = z.infer<typeof loginSchema>;

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function loginError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Почта, юзернейм или пароль не совпали. Проверьте данные и попробуйте снова.";
  }
  if (error instanceof ApiError && error.status === 429) {
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  }
  return error instanceof Error ? error.message : "Не удалось войти. Попробуйте ещё раз.";
}

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  // Switching accounts lands here with the handle already chosen, so only the password is left.
  const prefill = searchParams.get("identifier") ?? "";

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

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (session) => {
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
  });

  return (
    <AuthShell>
      <section aria-labelledby="login-title">
        <h1 className={styles.plainTitle} id="login-title">
          Вход
        </h1>
        <p className={styles.plainSubtitle}>Введите свои данные</p>

        <form
          // `post`, so that if hydration has not finished the browser cannot submit the
          // password as a query string into the URL and the history.
          method="post"
          className={styles.plainForm}
          onSubmit={form.handleSubmit((values) => login.mutate(values))}
          noValidate
        >
          {login.isError ? <FormNotice kind="error">{loginError(login.error)}</FormNotice> : null}
          {login.isSuccess ? <FormNotice kind="success">Вход выполнен. Открываем GRAM…</FormNotice> : null}

          <TextField
            label="Почта или юзернейм"
            placeholder="name@example.com"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            error={form.formState.errors.identifier?.message}
            {...form.register("identifier")}
          />
          <PasswordField
            label="Пароль"
            placeholder="••••••••••••"
            autoComplete="current-password"
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />

          <Link className={styles.rightLink} href="/login/recover">
            Забыли пароль?
          </Link>

          <SubmitButton className={styles.whiteButton} pending={login.isPending} pendingLabel="Входим…">
            Войти
          </SubmitButton>

          {/* The reference offers a QR sign-in beside the password one; ours says what it is
              rather than opening a scanner that has nothing to talk to yet. */}
          <Link className={styles.ghostButton} href="/login/qr">
            <QrCode size={20} />
            Войти по QR-коду
          </Link>
        </form>

        <p className={styles.plainSwitch}>
          Ещё нет аккаунта? <Link href="/register">Создать аккаунт</Link>
        </p>

        {/* Accounts this browser has used before: one tap fills the handle in. */}
        <div style={{ marginTop: 26 }}>
          <AccountSwitcher variant="login" />
        </div>
      </section>
    </AuthShell>
  );
}
