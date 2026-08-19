"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Camera,
  Check,
  Hand,
  ImagePlus,
  Palette,
  Plug,
  RefreshCw,
  Shield,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { API_URL, api } from "@/lib/api";
import { AccountSwitcher, MAX_DEVICE_ACCOUNTS } from "../auth/account-switcher";
import { useLogout } from "../auth/use-logout";
import { PROFILE_THEMES } from "@/lib/profile-color";
import { BottomSheet } from "../ui/bottom-sheet";
import { UserAvatar } from "../user-avatar";
import { NotificationSettings, PrivacySettings, StatusSettings } from "./settings-switches";

const TABS = [
  { value: "account", label: "Аккаунт", icon: UserRound },
  { value: "accounts", label: "Аккаунты", icon: Users },
  { value: "appearance", label: "Оформление", icon: Palette },
  { value: "integrations", label: "Интеграции", icon: Plug },
  { value: "security", label: "Безопасность", icon: Shield },
  { value: "privacy", label: "Приватность", icon: Hand },
  { value: "notifications", label: "Уведомления", icon: Bell },
] as const;

const schema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Укажите имя")
    .max(80, "Не больше 80 символов"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{3,31}$/, "a–z, 0–9 и _, минимум 4 символа"),
  bio: z.string().trim().max(280, "Не больше 280 символов"),
  location: z.string().trim().max(80, "Не больше 80 символов"),
  role_title: z.string().trim().max(100, "Не больше 100 символов"),
  interests: z.string().max(240, "Слишком длинный список"),
  profile_color: z.string(),
  website_url: z.string().trim().max(500, "Ссылка слишком длинная"),
  birthday: z.string().max(10),
  github_url: z.string().trim().max(500, "Ссылка слишком длинная"),
  telegram_url: z.string().trim().max(500, "Ссылка слишком длинная"),
  profile_song_title: z.string().trim().max(120, "Не больше 120 символов"),
  profile_song_artist: z.string().trim().max(120, "Не больше 120 символов"),
  profile_song_url: z.string().trim().max(500, "Ссылка слишком длинная"),
  // Comma-joined slugs and handles: the pickers below are the only things that write them.
  featured_communities: z.string(),
  visible_usernames: z.string(),
});
type EditForm = z.infer<typeof schema>;

/** Account editing lives in one sheet with six sections, like the reference. */
/** `"a,b"` → `["a", "b"]`, with `@` and casing normalised the way handles are stored. */
function splitHandles(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().replace(/^@+/, "").toLowerCase())
    .filter(Boolean);
}

/**
 * A grid of things to put on the profile — communities, handles — that toggles on tap.
 *
 * A `<select>` could only ever hold one, which is what made "поставить пару сообществ"
 * impossible. The count is capped, and the cap is stated rather than silently enforced.
 */
function ChoiceGrid({
  options,
  selected,
  max,
  onChange
}: {
  options: { value: string; title: string; subtitle: string; imageUrl: string | null }[];
  selected: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const full = selected.length >= max;
  return (
    <div className="grid gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={!active && full}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((item) => item !== option.value)
                  : [...selected, option.value]
              )
            }
            className="flex items-center gap-3 rounded-[14px] bg-[var(--surface-raised)] p-2 text-left transition hover:brightness-110 disabled:opacity-45"
            style={active ? { boxShadow: "inset 0 0 0 1.5px var(--primary-strong)" } : undefined}
          >
            <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-full bg-black/25 text-[13px] font-black text-[var(--primary-strong)]">
              {option.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={option.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                option.title.replace(/^@/, "").slice(0, 1).toUpperCase()
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9rem] font-semibold">{option.title}</span>
              <span className="block truncate text-[12px] text-[var(--muted)]">
                {option.subtitle}
              </span>
            </span>
            <span
              aria-hidden
              className="grid size-5 flex-none place-items-center rounded-md border"
              style={{
                borderColor: active ? "var(--primary-strong)" : "var(--line-strong)",
                background: active ? "var(--primary-strong)" : "transparent"
              }}
            >
              {active ? <Check size={13} /> : null}
            </span>
          </button>
        );
      })}
      <p className="m-0 text-[12px] text-[var(--muted)]">
        Выбрано {selected.length} из {max}.
      </p>
    </div>
  );
}

export function ProfileEditSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const logout = useLogout();
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("account");
  const [feedback, setFeedback] = useState("");

  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.currentUser,
    enabled: open,
  });
  // Only your own communities can go on your page, so the picker offers exactly those.
  const mine = useQuery({
    queryKey: ["my-communities"],
    queryFn: api.myCommunities,
    enabled: open,
  });
  // Same rule for handles: the profile can list the ones this account actually holds.
  const handles = useQuery({
    queryKey: ["usernames"],
    queryFn: api.usernames,
    enabled: open,
  });
  const ownedHandles = (handles.data ?? [])
    .filter((asset) => asset.is_owned_by_me && !asset.is_primary_handle)
    .map((asset) => asset.username.toLowerCase());
  const form = useForm<EditForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: "",
      username: "",
      bio: "",
      location: "",
      role_title: "",
      interests: "",
      profile_color: "default",
      website_url: "",
      birthday: "",
      github_url: "",
      telegram_url: "",
      profile_song_title: "",
      profile_song_artist: "",
      profile_song_url: "",
      featured_communities: "",
      visible_usernames: "",
    },
  });
  const profile = me.data;

  useEffect(() => {
    if (!profile) return;
    form.reset({
      display_name: profile.display_name,
      username: profile.username,
      bio: profile.bio ?? "",
      location: profile.location ?? "",
      role_title: profile.role_title ?? "",
      interests: (profile.interests ?? []).join(", "),
      profile_color: profile.profile_color ?? "default",
      website_url: profile.website_url ?? "",
      birthday: profile.birthday ?? "",
      github_url: profile.github_url ?? "",
      telegram_url: profile.telegram_url ?? "",
      profile_song_title: profile.profile_song_title ?? "",
      profile_song_artist: profile.profile_song_artist ?? "",
      profile_song_url: profile.profile_song_url ?? "",
      featured_communities: (
        profile.featured_community_slugs ??
        (profile.featured_community_slug ? [profile.featured_community_slug] : [])
      ).join(","),
      visible_usernames: (profile.related_usernames ?? []).join(","),
    });
  }, [form, profile]);

  const chosenCommunities = useWatch({ control: form.control, name: "featured_communities" });
  const chosenHandles = useWatch({ control: form.control, name: "visible_usernames" });

  const save = useMutation({
    mutationFn: (values: EditForm) =>
      api.updateCurrentUser({
        display_name: values.display_name,
        username: values.username,
        bio: values.bio,
        location: values.location || null,
        role_title: values.role_title || null,
        profile_color: values.profile_color,
        interests: values.interests
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
        website_url: values.website_url || null,
        birthday: values.birthday || null,
        github_url: values.github_url || null,
        telegram_url: values.telegram_url || null,
        profile_song_title: values.profile_song_title || null,
        profile_song_artist: values.profile_song_artist || null,
        profile_song_url: values.profile_song_url || null,
        featured_community_slugs: splitHandles(values.featured_communities),
        related_usernames: splitHandles(values.visible_usernames),
      }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({
          queryKey: ["profile", updated.username],
        }),
      ]);
      setFeedback("Профиль сохранён");
    },
  });

  const upload = useMutation({
    mutationFn: async ({
      file,
      kind,
    }: {
      file: File;
      kind: "avatar" | "cover";
    }) => {
      if (!file.type.match(/^image\/(png|jpeg|webp)$/))
        throw new Error("Поддерживаются PNG, JPG и WEBP");
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Файл должен быть не больше 5 МБ");
      return kind === "avatar" ? api.uploadAvatar(file) : api.uploadCover(file);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({
          queryKey: ["profile", profile?.username],
        }),
      ]);
      setFeedback(
        variables.kind === "avatar" ? "Аватар обновлён" : "Обложка обновлена",
      );
    },
  });

  const color = useWatch({ control: form.control, name: "profile_color" });
  const error = save.error?.message || upload.error?.message;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setFeedback("");
      }}
      title="Редактирование профиля"
      description="Аккаунт, оформление, интеграции, безопасность, приватность и уведомления."
      footer={
        <>
          <p className="mb-2 min-h-5 text-center text-xs" aria-live="polite">
            {error ? (
              <span className="text-[var(--danger)]">{error}</span>
            ) : feedback ? (
              <span className="text-[var(--online)]">{feedback}</span>
            ) : null}
          </p>
          <button
            className="profile-primary-action w-full"
            onClick={form.handleSubmit((values) => save.mutate(values))}
            disabled={save.isPending || upload.isPending}
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border-0 bg-[#17171d] text-[0.95rem] font-extrabold text-[var(--danger)]"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Выйти из аккаунта
          </button>
        </>
      }
    >
      <div className="-mx-4">
        <div className="relative flex-none">
          <div
            className="flex items-center gap-1.5 overflow-x-auto px-3 pb-3 [scrollbar-width:none]"
            role="tablist"
            aria-label="Разделы настроек"
          >
            {TABS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-label={label}
                title={label}
                onClick={() => setTab(value)}
                className="grid size-11 flex-none place-items-center rounded-full border-0 transition-colors"
                style={
                  tab === value
                    ? { background: "#ffffff", color: "#000000" }
                    : { background: "#17171d", color: "var(--muted)" }
                }
              >
                <Icon size={19} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="icon-button ml-auto flex-none bg-[#17171d]"
              aria-label="Закрыть"
            >
              <X size={19} />
            </button>
          </div>
          <div className="h-px bg-[var(--line)]" />
        </div>

        <div className="px-4 pt-4 sm:px-5">
          {me.isLoading || !profile ? (
            <div className="space-y-3">
              <div className="skeleton h-40 rounded-[20px]" />
              <div className="skeleton h-24 rounded-[20px]" />
            </div>
          ) : (
            <>
              <h2 className="m-0 text-[1.3rem] font-extrabold">
                {TABS.find((item) => item.value === tab)?.label}
              </h2>

              {tab === "account" ? (
                <div className="mt-4 grid gap-5">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => coverInput.current?.click()}
                      disabled={upload.isPending}
                      className="relative flex h-[132px] w-full items-center justify-center overflow-hidden rounded-[20px] border-0 bg-[#17171d] text-sm font-bold text-[var(--muted)]"
                    >
                      {profile.cover_url ? (
                        <Image
                          src={profile.cover_url}
                          alt=""
                          fill
                          unoptimized={profile.cover_url.startsWith(API_URL)}
                          sizes="620px"
                          className="object-cover"
                        />
                      ) : null}
                      <span className="relative flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm">
                        <ImagePlus size={16} />
                        Обложка профиля
                      </span>
                    </button>
                    <div className="absolute -bottom-6 left-4 rounded-full bg-[#121216] p-[3px]">
                      <UserAvatar
                        src={profile.avatar_url}
                        name={profile.display_name}
                        size={84}
                        ringColor="#121216"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      disabled={upload.isPending}
                      aria-label="Загрузить аватар"
                      className="absolute -bottom-2 left-[76px] grid size-9 place-items-center rounded-full border-0 bg-[var(--primary)] text-white"
                    >
                      <Camera size={17} />
                    </button>
                    <input
                      ref={coverInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate({ file, kind: "cover" });
                        event.target.value = "";
                      }}
                    />
                    <input
                      ref={avatarInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate({ file, kind: "avatar" });
                        event.target.value = "";
                      }}
                    />
                  </div>
                  <div className="mt-7 grid gap-5">
                    <Field
                      label="Имя"
                      hint="Ваше отображаемое имя"
                      error={form.formState.errors.display_name?.message}
                    >
                      <input
                        className="field px-4"
                        {...form.register("display_name")}
                      />
                    </Field>
                    <Field
                      label="Username"
                      hint="Уникальный идентификатор. Допустимые символы: a–z, 0–9 и _. Минимальная длина — 4 символа."
                      error={form.formState.errors.username?.message}
                    >
                      <input
                        className="field px-4"
                        autoCapitalize="none"
                        spellCheck={false}
                        {...form.register("username")}
                      />
                    </Field>
                    <Field
                      label="О себе"
                      hint="Расскажите немного о себе"
                      error={form.formState.errors.bio?.message}
                    >
                      <textarea
                        rows={4}
                        className="field resize-none p-4"
                        {...form.register("bio")}
                      />
                    </Field>
                    <Field
                      label="Город"
                      hint="Где вы находитесь"
                      error={form.formState.errors.location?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="Например, Киев"
                        {...form.register("location")}
                      />
                    </Field>
                    <Field
                      label="Роль"
                      hint="Короткая подпись под именем"
                      error={form.formState.errors.role_title?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="Founder & photographer"
                        {...form.register("role_title")}
                      />
                    </Field>
                    <Field
                      label="Интересы"
                      hint="Через запятую — до 12 тем"
                      error={form.formState.errors.interests?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="дизайн, музыка, коллекции"
                        {...form.register("interests")}
                      />
                    </Field>
                    <Field label="Дата рождения" hint="Показывается в профиле">
                      <input
                        className="field px-4"
                        type="date"
                        {...form.register("birthday")}
                      />
                    </Field>
                    {/* Saved on its own the moment it changes, not with the form: a status is a
                        switch, not a draft. */}
                    <StatusSettings />
                    <DangerZone />
                  </div>
                </div>
              ) : null}
              {tab === "appearance" ? (
                <div className="mt-4 grid gap-4">
                  <p className="mb-0 text-[0.86rem] leading-5 text-[var(--muted)]">
                    Цветовая схема профиля — имя, акценты и активные элементы
                    вашей страницы.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {PROFILE_THEMES.map((option) => (
                      <button
                        key={option.slug}
                        type="button"
                        onClick={() =>
                          form.setValue("profile_color", option.slug, {
                            shouldDirty: true,
                          })
                        }
                        aria-pressed={color === option.slug}
                        className="flex min-h-[54px] items-center gap-3 rounded-[16px] border-0 px-3 text-left text-[0.92rem] font-bold"
                        style={{
                          background:
                            color === option.slug ? "#101724" : "#121216",
                          boxShadow: `inset 0 0 0 1px ${color === option.slug ? option.accent : "var(--line)"}`,
                        }}
                      >
                        <span
                          className="size-7 flex-none rounded-full"
                          style={{ background: option.accent }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{
                            color:
                              option.slug === "default"
                                ? undefined
                                : option.accent,
                          }}
                        >
                          {option.label}
                        </span>
                        {color === option.slug ? (
                          <Check
                            size={17}
                            className="flex-none"
                            style={{ color: option.accent }}
                          />
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <Field
                    label="Сообщества в профиле"
                    hint="До трёх своих сообществ — карточками под шапкой. Чужие поставить нельзя."
                  >
                    {mine.data?.length ? (
                      <ChoiceGrid
                        options={mine.data.map((community) => ({
                          value: community.slug,
                          title: community.title ?? community.name,
                          subtitle: `@${community.slug}`,
                          imageUrl: community.avatar_url ?? null
                        }))}
                        selected={splitHandles(chosenCommunities ?? "")}
                        max={3}
                        onChange={(next) =>
                          form.setValue("featured_communities", next.join(","), {
                            shouldDirty: true
                          })
                        }
                      />
                    ) : (
                      <p className="m-0 text-[13px] text-[var(--muted)]">
                        У вас пока нет своего сообщества.{" "}
                        <Link href="/communities" className="font-semibold text-[var(--link)]">
                          Создать
                        </Link>
                      </p>
                    )}
                  </Field>
                  <Field
                    label="Юзернеймы в профиле"
                    hint="Выберите, какие из ваших имён увидят другие. Основное имя показывается всегда."
                  >
                    {ownedHandles.length ? (
                      <ChoiceGrid
                        options={ownedHandles.map((handle) => ({
                          value: handle,
                          title: `@${handle}`,
                          subtitle: "ваш юзернейм",
                          imageUrl: null
                        }))}
                        selected={splitHandles(chosenHandles ?? "")}
                        max={12}
                        onChange={(next) =>
                          form.setValue("visible_usernames", next.join(","), { shouldDirty: true })
                        }
                      />
                    ) : (
                      <p className="m-0 text-[13px] text-[var(--muted)]">
                        Дополнительных имён пока нет.{" "}
                        <Link href="/market" className="font-semibold text-[var(--link)]">
                          Купить в маркете
                        </Link>
                      </p>
                    )}
                  </Field>
                </div>
              ) : null}

              {tab === "integrations" ? (
                <div className="mt-4 grid gap-5">
                  <Field
                    label="Сайт"
                    hint="Ссылка в шапке профиля"
                    error={form.formState.errors.website_url?.message}
                  >
                    <input
                      className="field px-4"
                      inputMode="url"
                      placeholder="https://example.com"
                      {...form.register("website_url")}
                    />
                  </Field>
                  <Field
                    label="GitHub"
                    error={form.formState.errors.github_url?.message}
                  >
                    <input
                      className="field px-4"
                      inputMode="url"
                      placeholder="https://github.com/name"
                      {...form.register("github_url")}
                    />
                  </Field>
                  <Field
                    label="Telegram"
                    error={form.formState.errors.telegram_url?.message}
                  >
                    <input
                      className="field px-4"
                      inputMode="url"
                      placeholder="https://t.me/name"
                      {...form.register("telegram_url")}
                    />
                  </Field>
                  <Field
                    label="Песня профиля"
                    hint="Название, исполнитель и ссылка на аудио"
                  >
                    <input
                      className="field px-4"
                      placeholder="Название"
                      {...form.register("profile_song_title")}
                    />
                  </Field>
                  <input
                    className="field px-4"
                    placeholder="Исполнитель"
                    {...form.register("profile_song_artist")}
                  />
                  <input
                    className="field px-4"
                    inputMode="url"
                    placeholder="https://…/track.mp3"
                    {...form.register("profile_song_url")}
                  />
                </div>
              ) : null}

              {tab === "security" ? (
                <SecurityTab onFeedback={setFeedback} />
              ) : null}

              {tab === "accounts" ? (
                <div className="mt-4 grid gap-4">
                  <p className="mb-0 text-[0.86rem] leading-5 text-[var(--muted)]">
                    До {MAX_DEVICE_ACCOUNTS} аккаунтов на этом устройстве. Переключение
                    мгновенное: у каждого своя сессия в httpOnly-cookie, пароль повторно не
                    нужен. Пароли здесь не хранятся.
                  </p>
                  <AccountSwitcher variant="app" />
                </div>
              ) : null}

              {tab === "privacy" ? <PrivacySettings /> : null}

              {tab === "notifications" ? <NotificationSettings /> : null}
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[0.98rem] font-extrabold">{label}</span>
      {hint ? (
        <span className="text-[0.82rem] leading-5 text-[var(--muted)]">
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="text-xs text-[var(--danger)]">{error}</span>
      ) : null}
    </label>
  );
}

function SecurityTab({ onFeedback }: { onFeedback: (text: string) => void }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const sessions = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: api.authSessions,
  });
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      onFeedback("Пароль изменён, другие устройства отключены");
    },
  });
  const revoke = useMutation({
    mutationFn: api.revokeOtherSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      onFeedback("Другие сессии отключены");
    },
  });

  return (
    <div className="mt-4 grid gap-5">
      <div className="grid gap-3">
        <Field
          label="Смена пароля"
          hint="Минимум 10 символов. Другие устройства выйдут автоматически."
        >
          <input
            className="field px-4"
            type="password"
            autoComplete="current-password"
            placeholder="Текущий пароль"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <input
          className="field px-4"
          type="password"
          autoComplete="new-password"
          placeholder="Новый пароль"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <button
          className="quiet-button"
          onClick={() => change.mutate()}
          disabled={change.isPending || current.length < 1 || next.length < 10}
        >
          {change.isPending ? "Меняем…" : "Изменить пароль"}
        </button>
        {change.error ? (
          <p className="mb-0 text-xs text-[var(--danger)]">
            {change.error.message}
          </p>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <strong className="text-[0.98rem]">Активные сессии</strong>
          <button
            className="quiet-button !min-h-9 !px-3 text-xs"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
          >
            Отключить другие
          </button>
        </div>
        {sessions.isLoading ? (
          <div className="skeleton h-20 rounded-[18px]" />
        ) : sessions.isError ? (
          <button className="quiet-button" onClick={() => sessions.refetch()}>
            <RefreshCw size={16} />
            Повторить
          </button>
        ) : (
          <div className="overflow-hidden rounded-[18px] bg-[#121216] shadow-[inset_0_0_0_1px_var(--line)]">
            {(sessions.data ?? []).map((item) => (
              <div
                key={item.id}
                className="border-b border-[var(--line)] px-4 py-3 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <strong className="truncate text-[0.88rem]">
                    {item.user_agent ?? "Неизвестное устройство"}
                  </strong>
                  {item.current ? (
                    <span className="rounded-full bg-[#12231a] px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-[.1em] text-[var(--online)]">
                      это устройство
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {item.ip_address ?? "IP скрыт"} · вход{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(item.created_at))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DangerZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: () => router.replace("/login"),
  });
  return (
    <div className="mt-3 rounded-[18px] bg-[#1e1214] p-3.5 shadow-[inset_0_0_0_1px_#3a1c22]">
      <strong className="text-[0.92rem] text-[var(--danger)]">
        Опасная зона
      </strong>
      <p className="mb-0 mt-1 text-[0.8rem] leading-5 text-[#e0b4bb]">
        Удаление аккаунта необратимо: профиль, посты, сообщения, подписки и
        подарки будут удалены навсегда.
      </p>
      {open ? (
        <div className="mt-2.5 grid gap-2">
          <input
            className="field px-4"
            type="password"
            autoComplete="current-password"
            placeholder="Пароль для подтверждения"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="quiet-button flex-1"
              onClick={() => {
                setOpen(false);
                setPassword("");
              }}
            >
              Отмена
            </button>
            <button
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-full border-0 bg-[#7a1f2b] px-4 text-sm font-extrabold text-white"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || password.length < 1}
            >
              {remove.isPending ? "Удаляем…" : "Удалить навсегда"}
            </button>
          </div>
          {remove.error ? (
            <p className="mb-0 text-xs text-[var(--danger)]">
              {remove.error.message}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          className="mt-2.5 min-h-11 w-full rounded-full border-0 bg-transparent text-sm font-extrabold text-[var(--danger)]"
          onClick={() => setOpen(true)}
        >
          Удалить аккаунт
        </button>
      )}
    </div>
  );
}
