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
      context.addIssue({ code: "custom", message: "Choose an image" });
      return;
    }
    if (!AVATAR_TYPES.has(value.type)) {
      context.addIssue({ code: "custom", message: "PNG, JPG, or WEBP work" });
    }
    if (value.size > MAX_AVATAR_BYTES) {
      context.addIssue({ code: "custom", message: "The file must be no larger than 5 MB" });
    }
  })
  .transform((value) => value as File);

export const onboardingSchema = z.object({
  display_name: z.string().trim().min(2, "Enter a name — at least 2 characters").max(80, "No more than 80 characters"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(32, "No more than 32 characters")
    .regex(/^[a-z][a-z0-9_]*$/, "Start with a Latin letter; use a–z, 0–9, and _"),
  interests: z.array(z.string()).max(5, "Choose no more than five topics")
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

const INTERESTS = [
  "Design",
  "Technology",
  "Music",
  "Film",
  "Games",
  "Photography",
  "Education",
  "Business",
  "Sports",
  "Collections"
] as const;

function onboardingError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "This username is already taken. Choose another — the rest of your details will stay in the form.";
  }
  if (error instanceof ApiError && error.status === 413) {
    return "The avatar is larger than 5 MB. Choose a smaller file.";
  }
  if (error instanceof ApiError && error.status === 415) {
    return "That avatar format isn’t supported. Choose PNG, JPG, or WEBP.";
  }
  return error instanceof Error ? error.message : "Couldn’t save your profile. Please try again.";
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
        form.setError("username", { type: "server", message: "Username already taken" }, { shouldFocus: true });
      }
    }
  });

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    const result = avatarFileSchema.safeParse(file);
    if (!result.success) {
      setAvatarFile(null);
      setPreviewUrl(null);
      setAvatarError(result.error.issues[0]?.message ?? "Couldn’t read the file");
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
          <LoaderCircle className={styles.spin} size={24} /> Checking your account…
        </section>
      </AuthShell>
    );
  }

  if (session.isError && !(session.error instanceof ApiError && session.error.status === 401)) {
    return (
      <AuthShell>
        <section className={styles.authCard}>
          <div className={styles.formHeading}>
            <h1>Couldn’t open setup</h1>
            <p>Check your connection to the server and try again.</p>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => session.refetch()}>
            Try again
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
          <span>Step 2 of 2</span>
        </div>
        <div className={styles.formHeading}>
          <h1 id="onboarding-title">Build your identity</h1>
          <p>Your name and username are visible to others. You can change your avatar and topics later.</p>
        </div>

        <form className={styles.onboardingForm} onSubmit={form.handleSubmit((values) => complete.mutate(values))} noValidate>
          <div className={styles.avatarColumn}>
            <button
              className={styles.avatarPicker}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={avatarSrc ? "Replace avatar" : "Upload avatar"}
            >
              <span className={styles.avatarPreview}>
                {avatarSrc ? (
                  <span
                    className={styles.avatarImage}
                    role="img"
                    aria-label="Avatar preview"
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
              <strong>{avatarFile ? avatarFile.name : "Add an avatar"}</strong>
              <span>PNG, JPG, or WEBP · up to 5 MB</span>
              {avatarError ? <span className={styles.fieldError} role="alert">{avatarError}</span> : null}
            </div>
          </div>

          <div className={styles.identityFields}>
            {complete.isError ? <FormNotice kind="error">{onboardingError(complete.error)}</FormNotice> : null}
            <TextField
              label="Name"
              placeholder="What should we call you"
              autoComplete="name"
              maxLength={80}
              error={form.formState.errors.display_name?.message}
              {...form.register("display_name")}
            />
            <div className={styles.usernameField}>
              <span className={styles.usernamePrefix} aria-hidden="true">@</span>
              <TextField
                label="Unique username"
                placeholder="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                hint="3 to 32 characters. Uniqueness is checked when you save."
                error={form.formState.errors.username?.message}
                {...form.register("username")}
              />
            </div>
          </div>

          <fieldset className={styles.interestsFieldset}>
            <legend>What to show in recommendations <span>optional · up to 5</span></legend>
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
            <p>You can skip the avatar and topics. Your name and username are needed for your profile and chats.</p>
            <SubmitButton pending={complete.isPending} pendingLabel="Building your profile…">Open GRAM</SubmitButton>
          </div>
        </form>
      </section>
    </AuthShell>
  );
}
