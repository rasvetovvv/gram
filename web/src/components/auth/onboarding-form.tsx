"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, LoaderCircle, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";
import { FormNotice, SubmitButton, TextField } from "./form-controls";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const avatarFileSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (typeof File === "undefined" || !(value instanceof File)) {
      context.addIssue({ code: "custom", message: "Выберите изображение" });
      return;
    }
    if (!AVATAR_TYPES.has(value.type)) {
      context.addIssue({ code: "custom", message: "Подойдут PNG, JPG или WEBP" });
    }
    if (value.size > MAX_AVATAR_BYTES) {
      context.addIssue({ code: "custom", message: "Файл должен быть не больше 5 МБ" });
    }
  })
  .transform((value) => value as File);

export const onboardingSchema = z.object({
  display_name: z.string().trim().min(2, "Введите имя — минимум 2 символа").max(80, "Не больше 80 символов"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Минимум 3 символа")
    .max(32, "Не больше 32 символов")
    .regex(/^[a-z][a-z0-9_]*$/, "Начните с латинской буквы; используйте a–z, 0–9 и _"),
  interests: z.array(z.string()).max(5, "Выберите не больше пяти тем")
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

const INTERESTS = [
  "Дизайн",
  "Технологии",
  "Музыка",
  "Кино",
  "Игры",
  "Фотография",
  "Образование",
  "Бизнес",
  "Спорт",
  "Коллекции"
] as const;

function onboardingError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "Этот юзернейм уже занят. Выберите другой — остальные данные останутся в форме.";
  }
  if (error instanceof ApiError && error.status === 413) {
    return "Аватар оказался больше 5 МБ. Выберите файл меньшего размера.";
  }
  if (error instanceof ApiError && error.status === 415) {
    return "Формат аватара не поддерживается. Выберите PNG, JPG или WEBP.";
  }
  return error instanceof Error ? error.message : "Не удалось сохранить профиль. Попробуйте ещё раз.";
}

export function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarUploadedRef = useRef(false);
  const storedUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const session = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.restoreSession,
    retry: false,
    staleTime: 60_000,
    initialData: storedUser ?? undefined
  });

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { display_name: "", username: "", interests: [] },
    mode: "onBlur"
  });

  const selectedInterests = useWatch({ control: form.control, name: "interests" }) ?? [];

  useEffect(() => {
    if (!session.data) return;
    setUser(session.data);
    if (session.data.onboarding_complete !== false) router.replace("/");
  }, [router, session.data, setUser]);

  useEffect(() => {
    if (!(session.error instanceof ApiError) || session.error.status !== 401) return;
    clearSession();
    router.replace("/login");
  }, [clearSession, router, session.error]);

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const complete = useMutation({
    mutationFn: async (values: OnboardingValues) => {
      await api.updateCurrentUser({
        display_name: values.display_name.trim(),
        username: values.username.trim().toLowerCase(),
        interests: values.interests,
        onboarding_complete: false
      });
      if (avatarFile && !avatarUploadedRef.current) {
        await api.uploadAvatar(avatarFile);
        avatarUploadedRef.current = true;
      }
      return api.updateCurrentUser({ onboarding_complete: true });
    },
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(["auth", "me"], user);
      queryClient.setQueryData(["me"], user);
      router.replace("/");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        form.setError("username", { type: "server", message: "Юзернейм уже занят" }, { shouldFocus: true });
      }
    }
  });

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    const result = avatarFileSchema.safeParse(file);
    if (!result.success) {
      setAvatarFile(null);
      setPreviewUrl(null);
      setAvatarError(result.error.issues[0]?.message ?? "Не удалось прочитать файл");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAvatarError(null);
    setAvatarFile(result.data);
    avatarUploadedRef.current = false;
    setPreviewUrl(URL.createObjectURL(result.data));
  }

  function toggleInterest(interest: string) {
    const current = form.getValues("interests");
    if (current.includes(interest)) {
      form.setValue("interests", current.filter((item) => item !== interest), { shouldDirty: true, shouldValidate: true });
      return;
    }
    if (current.length < 5) {
      form.setValue("interests", [...current, interest], { shouldDirty: true, shouldValidate: true });
    }
  }

  if (session.isPending) {
    return (
      <AuthShell>
        <section className={`${styles.authCard} ${styles.onboardingLoading}`} aria-live="polite">
          <LoaderCircle className={styles.spin} size={24} /> Проверяем аккаунт…
        </section>
      </AuthShell>
    );
  }

  if (session.isError && !(session.error instanceof ApiError && session.error.status === 401)) {
    return (
      <AuthShell>
        <section className={styles.authCard}>
          <div className={styles.formHeading}>
            <h1>Не удалось открыть настройку</h1>
            <p>Проверьте соединение с сервером и повторите попытку.</p>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => session.refetch()}>
            Попробовать снова
          </button>
        </section>
      </AuthShell>
    );
  }

  if (!session.data || session.data.onboarding_complete !== false) return null;

  const avatarSrc = previewUrl ?? session.data.avatar_url;

  return (
    <AuthShell wide>
      <section className={`${styles.authCard} ${styles.onboardingCard}`} aria-labelledby="onboarding-title">
        <div className={styles.onboardingTopline}>
          <span>Шаг 2 из 2</span>
        </div>
        <div className={styles.formHeading}>
          <h1 id="onboarding-title">Соберите свою личность</h1>
          <p>Имя и юзернейм видят другие люди. Аватар и темы можно изменить позже.</p>
        </div>

        <form className={styles.onboardingForm} onSubmit={form.handleSubmit((values) => complete.mutate(values))} noValidate>
          <div className={styles.avatarColumn}>
            <button
              className={styles.avatarPicker}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={avatarSrc ? "Заменить аватар" : "Загрузить аватар"}
            >
              <span className={styles.avatarPreview}>
                {avatarSrc ? (
                  <span
                    className={styles.avatarImage}
                    role="img"
                    aria-label="Предпросмотр аватара"
                    style={{ backgroundImage: `url(${JSON.stringify(avatarSrc)})` }}
                  />
                ) : (
                  <UserRound size={42} />
                )}
              </span>
              <span className={styles.cameraBadge}><Camera size={17} /></span>
            </button>
            <input
              ref={fileInputRef}
              className={styles.srOnly}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseAvatar(event.target.files?.[0])}
            />
            <div className={styles.avatarCopy}>
              <strong>{avatarFile ? avatarFile.name : "Добавьте аватар"}</strong>
              <span>PNG, JPG или WEBP · до 5 МБ</span>
              {avatarError ? <span className={styles.fieldError} role="alert">{avatarError}</span> : null}
            </div>
          </div>

          <div className={styles.identityFields}>
            {complete.isError ? <FormNotice kind="error">{onboardingError(complete.error)}</FormNotice> : null}
            <TextField
              label="Имя"
              placeholder="Как к вам обращаться"
              autoComplete="name"
              maxLength={80}
              error={form.formState.errors.display_name?.message}
              {...form.register("display_name")}
            />
            <div className={styles.usernameField}>
              <span className={styles.usernamePrefix} aria-hidden="true">@</span>
              <TextField
                label="Уникальный юзернейм"
                placeholder="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                hint="От 3 до 32 символов. Уникальность проверяется при сохранении."
                error={form.formState.errors.username?.message}
                {...form.register("username")}
              />
            </div>
          </div>

          <fieldset className={styles.interestsFieldset}>
            <legend>Что показать в рекомендациях <span>необязательно · до 5</span></legend>
            <div className={styles.interestList}>
              {INTERESTS.map((interest) => {
                const selected = selectedInterests.includes(interest);
                return (
                  <button
                    key={interest}
                    className={styles.interestButton}
                    data-selected={selected}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleInterest(interest)}
                    disabled={!selected && selectedInterests.length >= 5}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
            {form.formState.errors.interests?.message ? (
              <span className={styles.fieldError}>{form.formState.errors.interests.message}</span>
            ) : null}
          </fieldset>

          <div className={styles.onboardingActions}>
            <p>Аватар и темы можно пропустить. Имя и юзернейм нужны для профиля и чатов.</p>
            <SubmitButton pending={complete.isPending} pendingLabel="Собираем профиль…">Открыть GRAM</SubmitButton>
          </div>
        </form>
      </section>
    </AuthShell>
  );
}
