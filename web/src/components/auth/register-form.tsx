"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
import { rememberAccount } from "@/lib/accounts";
import { useAuthStore } from "@/store/auth";

import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { FormNotice, PasswordField, SubmitButton, TextField } from "./form-controls";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .min(5, "Введите почту")
    .max(254, "Слишком длинный адрес")
    .email("Проверьте адрес почты"),
  password: z
    .string()
    .min(10, "Минимум 10 символов")
    .max(128, "Пароль слишком длинный")
});

type RegisterValues = z.infer<typeof registerSchema>;

function registerError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "Эта почта уже занята. Войдите или используйте другую.";
  }
  return error instanceof Error ? error.message : "Не удалось создать аккаунт. Попробуйте ещё раз.";
}

export function RegisterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur"
  });

  const register = useMutation({
    mutationFn: api.register,
    onSuccess: (session) => {
      setUser(session.user);
      rememberAccount(session.user);
      queryClient.setQueryData(["auth", "me"], session.user);
      queryClient.setQueryData(["me"], session.user);
      // A fresh account has no handle or name yet, so onboarding is the only sensible next step.
      router.replace("/onboarding");
    }
  });

  return (
    <AuthShell>
      <section aria-labelledby="register-title">
        <h1 className={styles.plainTitle} id="register-title">
          Регистрация
        </h1>
        <p className={styles.plainSubtitle}>Создайте аккаунт, чтобы начать</p>

        <form
          // `post`, so that if hydration has not finished the browser cannot submit the
          // password as a query string into the URL and the history.
          method="post"
          className={styles.plainForm}
          onSubmit={form.handleSubmit((values) => register.mutate(values))}
          noValidate
        >
          {register.isError ? (
            <FormNotice kind="error">{registerError(register.error)}</FormNotice>
          ) : null}
          {register.isSuccess ? (
            <FormNotice kind="success">Аккаунт создан. Осталось выбрать юзернейм…</FormNotice>
          ) : null}

          <TextField
            label="Почта"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            error={form.formState.errors.email?.message}
            {...form.register("email")}
          />
          <PasswordField
            label="Пароль"
            placeholder="••••••••••••"
            autoComplete="new-password"
            hint="Не короче 10 символов."
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />

          <SubmitButton
            className={styles.whiteButton}
            pending={register.isPending}
            pendingLabel="Создаём…"
          >
            Создать аккаунт
          </SubmitButton>
        </form>

        <p className={styles.plainSwitch}>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </section>
    </AuthShell>
  );
}
