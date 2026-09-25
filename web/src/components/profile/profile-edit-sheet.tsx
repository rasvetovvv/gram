"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Camera,
  Check,
  Crown,
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
import { isVideoUrl } from "@/lib/utils";
import { AccountSwitcher, MAX_DEVICE_ACCOUNTS } from "../auth/account-switcher";
import { useLogout } from "../auth/use-logout";
import { PROFILE_THEMES } from "@/lib/profile-color";
import { BottomSheet } from "../ui/bottom-sheet";
import { UserAvatar } from "../user-avatar";
import { NotificationSettings, PrivacySettings, StatusSettings } from "./settings-switches";

const TABS = [
  { value: "account", label: "Account", icon: UserRound },
  { value: "accounts", label: "Accounts", icon: Users },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "integrations", label: "Integrations", icon: Plug },
  { value: "security", label: "Security", icon: Shield },
  { value: "privacy", label: "Privacy", icon: Hand },
  { value: "notifications", label: "Notifications", icon: Bell },
] as const;

const schema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Enter a name")
    .max(80, "No more than 80 characters"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{3,31}$/, "a–z, 0–9, and _, at least 4 characters"),
  // Premium doubles this; the server refuses the difference for everybody else, so the form
  // accepts the larger number and the hint under the field says whose it is.
  bio: z.string().trim().max(560, "No more than 560 characters"),
  location: z.string().trim().max(80, "No more than 80 characters"),
  role_title: z.string().trim().max(100, "No more than 100 characters"),
  interests: z.string().max(240, "That list is too long"),
  profile_color: z.string(),
  website_url: z.string().trim().max(500, "That link is too long"),
  birthday: z.string().max(10),
  github_url: z.string().trim().max(500, "That link is too long"),
  telegram_url: z.string().trim().max(500, "That link is too long"),
  profile_song_title: z.string().trim().max(120, "No more than 120 characters"),
  profile_song_artist: z.string().trim().max(120, "No more than 120 characters"),
  profile_song_url: z.string().trim().max(500, "That link is too long"),
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
 * A `<select>` could only ever hold one, which is what made "featuring a couple of communities"
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
  /* What the grid can actually show as chosen. A value with no row of its own used to survive every
     toggle — `selected.filter(…)` kept it, and it went back to the server on save — so anything
     selected but not offered could not be switched off by any means the owner had. Narrowing here
     makes the rule "what you see is what is saved" true even when the two lists disagree. */
  const offered = new Set(options.map((option) => option.value));
  const picked = selected.filter((item) => offered.has(item));
  const full = picked.length >= max;
  return (
    <div className="grid gap-1.5">
      {options.map((option) => {
        const active = picked.includes(option.value);
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
                  ? picked.filter((item) => item !== option.value)
                  : [...picked, option.value]
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
        {picked.length} of {max} selected.
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
  /* The ceiling the server enforces, and how much of it is used. Read from the profile rather than
     hardcoded, so the picker and the API can never disagree about how many handles are allowed —
     they did, and the form silently capped at twelve while the server accepted twenty. */
  const maxHandles = profile?.max_usernames ?? 20;
  const ownedCount = profile?.owned_usernames?.length ?? ownedHandles.length + 1;

  /* Which account the form currently holds, so it is seeded once per opening.
   *
   * `me.data` is a fresh object on every refetch, and this effect used to depend on it directly: any
   * background refresh of the profile — a presence tick, a save elsewhere, the window regaining
   * focus — called `reset` and threw away whatever had not been saved yet. Unticking a handle and
   * pressing “Save” a moment later saved the list as it was before the tick, so the handle
   * came back and the form looked like it had ignored the change. It had: it never had it. */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Re-seed on the next opening, so a sheet reopened after a save shows what was saved.
      seededFor.current = null;
      return;
    }
    if (!profile || seededFor.current === profile.id) return;
    seededFor.current = profile.id;
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
  }, [form, open, profile]);

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
      setFeedback("Profile saved");
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
      // A clip is allowed too: an avatar or a cover can be alive, and the API keeps whichever
      // arrived. The two limits differ because a video is heavier by nature.
      const video = file.type.startsWith("video/");
      if (!video && !file.type.match(/^image\/(png|jpeg|webp)$/))
        throw new Error("PNG, JPG, WEBP, or MP4 / WEBM video are supported");
      if (video && !file.type.match(/^video\/(mp4|webm|quicktime)$/))
        throw new Error("A live photo can be MP4 or WEBM");
      const limit = video ? 20 : 5;
      if (file.size > limit * 1024 * 1024)
        throw new Error(`The file must be no larger than ${limit} MB`);
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
        variables.kind === "avatar" ? "Avatar updated" : "Cover updated",
      );
    },
  });

  const color = useWatch({ control: form.control, name: "profile_color" });
  // What Premium unlocks on this sheet: a name colour, and twice the description.
  const premium = Boolean(me.data?.is_premium);
  const error = save.error?.message || upload.error?.message;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setFeedback("");
      }}
      title="Edit profile"
      description="Account, appearance, integrations, security, privacy, and notifications."
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
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border-0 bg-[#17171d] text-[0.95rem] font-extrabold text-[var(--danger)]"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Log out
          </button>
        </>
      }
    >
      <div className="-mx-4">
        <div className="relative flex-none">
          <div
            className="flex items-center gap-1.5 overflow-x-auto px-3 pb-3 [scrollbar-width:none]"
            role="tablist"
            aria-label="Settings sections"
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
              aria-label="Close"
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
            /* Keyed by the section, so moving between “Account”, “Appearance” and the rest fades the
               body instead of replacing a tall form with another one under a fixed heading. */
            <div key={tab} className="panel-enter">
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
                      {isVideoUrl(profile.cover_url) ? (
                        /* Live cover: shown the same way it will appear on the profile. */
                        <video
                          src={profile.cover_url ?? undefined}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          aria-hidden
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : profile.cover_url ? (
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
                        Profile cover
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
                      aria-label="Upload avatar"
                      className="absolute -bottom-2 left-[76px] grid size-9 place-items-center rounded-full border-0 bg-[var(--primary)] text-white"
                    >
                      <Camera size={17} />
                    </button>
                    <p className="absolute -bottom-5 right-1 m-0 text-[11px] text-[var(--dim)]">
                      Photo or video — live avatar and cover
                    </p>
                    <input
                      ref={coverInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
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
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
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
                      label="Name"
                      hint="Your display name"
                      error={form.formState.errors.display_name?.message}
                    >
                      <input
                        className="field px-4"
                        {...form.register("display_name")}
                      />
                    </Field>
                    <Field
                      label="Username"
                      hint="A unique identifier. Allowed characters: a–z, 0–9, and _. Minimum length is 4 characters."
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
                      label="About"
                      hint="Tell people a little about yourself"
                      error={form.formState.errors.bio?.message}
                    >
                      <textarea
                        rows={4}
                        className="field resize-none p-4"
                        {...form.register("bio")}
                      />
                    </Field>
                    <Field
                      label="City"
                      hint="Where you’re based"
                      error={form.formState.errors.location?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="For example, Kyiv"
                        {...form.register("location")}
                      />
                    </Field>
                    <Field
                      label="Role"
                      hint="A short caption under your name"
                      error={form.formState.errors.role_title?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="Founder & photographer"
                        {...form.register("role_title")}
                      />
                    </Field>
                    <Field
                      label="Interests"
                      hint="Comma-separated — up to 12 topics"
                      error={form.formState.errors.interests?.message}
                    >
                      <input
                        className="field px-4"
                        placeholder="design, music, collections"
                        {...form.register("interests")}
                      />
                    </Field>
                    <Field label="Birthday" hint="Shown on your profile">
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
                    Your profile color scheme — your name, accents, and the active elements
                    of your page.
                  </p>
                  {/* The palette is Premium's. A colour already chosen keeps working, so the lock
                      is on choosing a new one — which is what the subscription actually buys. */}
                  {premium ? null : (
                    <p className="m-0 flex items-start gap-2 rounded-[14px] bg-[var(--surface-raised)] p-3 text-[0.82rem] leading-5 text-[var(--muted)]">
                      <Crown size={15} className="mt-0.5 flex-none text-[var(--stars)]" />
                      <span>
                        A name color unlocks{" "}
                        <Link href="/premium" className="font-semibold text-[var(--link)]">
                          GRAM Premium
                        </Link>
                        . The color you choose stays with you even after the subscription ends.
                      </span>
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {PROFILE_THEMES.map((option) => (
                      <button
                        key={option.slug}
                        type="button"
                        disabled={!premium && option.slug !== "default"}
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
                    label="Communities on your profile"
                    hint="Up to three of your own communities — as cards under the header. You can’t add others’."
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
                        You don’t have a community of your own yet.{" "}
                        <Link href="/communities" className="font-semibold text-[var(--link)]">
                          Create
                        </Link>
                      </p>
                    )}
                  </Field>
                  <Field
                    label="Usernames on your profile"
                    hint={
                      ownedHandles.length
                        ? `Choose which of your names others will see. Your primary name is always shown. ${ownedCount} of ${maxHandles} used.`
                        : "Choose which of your names others will see. Your primary name is always shown."
                    }
                  >
                    {ownedHandles.length ? (
                      <ChoiceGrid
                        options={ownedHandles.map((handle) => ({
                          value: handle,
                          title: `@${handle}`,
                          subtitle: "your username",
                          imageUrl: null
                        }))}
                        selected={splitHandles(chosenHandles ?? "")}
                        /* The cap the account actually has, so the picker can never refuse a handle
                           the profile is allowed to show. It used to be hardcoded at 12 while the
                           server accepted 20. */
                        max={maxHandles}
                        onChange={(next) =>
                          form.setValue("visible_usernames", next.join(","), { shouldDirty: true })
                        }
                      />
                    ) : (
                      <p className="m-0 text-[13px] text-[var(--muted)]">
                        No additional names yet.{" "}
                        <Link href="/market" className="font-semibold text-[var(--link)]">
                          Buy on the market
                        </Link>
                      </p>
                    )}
                  </Field>
                </div>
              ) : null}

              {tab === "integrations" ? (
                <div className="mt-4 grid gap-5">
                  <Field
                    label="Website"
                    hint="A link in your profile header"
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
                    label="Profile song"
                    hint="Title, artist, and a link to the audio"
                  >
                    <input
                      className="field px-4"
                      placeholder="Title"
                      {...form.register("profile_song_title")}
                    />
                  </Field>
                  <input
                    className="field px-4"
                    placeholder="Artist"
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
                    Up to {MAX_DEVICE_ACCOUNTS} accounts on this device. Switching is
                    instant: each has its own session in an httpOnly cookie, and no password is
                    needed again. Passwords are not stored here.
                  </p>
                  <AccountSwitcher variant="app" />
                </div>
              ) : null}

              {tab === "privacy" ? <PrivacySettings /> : null}

              {tab === "notifications" ? <NotificationSettings /> : null}
            </div>
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
      onFeedback("Password changed; other devices have been logged out");
    },
  });
  const revoke = useMutation({
    mutationFn: api.revokeOtherSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      onFeedback("Other sessions have been logged out");
    },
  });

  return (
    <div className="mt-4 grid gap-5">
      <div className="grid gap-3">
        <Field
          label="Change password"
          hint="At least 10 characters. Other devices will be logged out automatically."
        >
          <input
            className="field px-4"
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <input
          className="field px-4"
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <button
          className="quiet-button"
          onClick={() => change.mutate()}
          disabled={change.isPending || current.length < 1 || next.length < 10}
        >
          {change.isPending ? "Changing…" : "Change password"}
        </button>
        {change.error ? (
          <p className="mb-0 text-xs text-[var(--danger)]">
            {change.error.message}
          </p>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <strong className="text-[0.98rem]">Active sessions</strong>
          <button
            className="quiet-button !min-h-9 !px-3 text-xs"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
          >
            Log out others
          </button>
        </div>
        {sessions.isLoading ? (
          <div className="skeleton h-20 rounded-[18px]" />
        ) : sessions.isError ? (
          <button className="quiet-button" onClick={() => sessions.refetch()}>
            <RefreshCw size={16} />
            Retry
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
                    {item.user_agent ?? "Unknown device"}
                  </strong>
                  {item.current ? (
                    <span className="rounded-full bg-[#12231a] px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-[.1em] text-[var(--online)]">
                      this device
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {item.ip_address ?? "IP hidden"} · signed in{" "}
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
        Danger zone
      </strong>
      <p className="mb-0 mt-1 text-[0.8rem] leading-5 text-[#e0b4bb]">
        Deleting your account is irreversible: your profile, posts, messages, subscriptions, and
        gifts will be permanently deleted.
      </p>
      {open ? (
        <div className="mt-2.5 grid gap-2">
          <input
            className="field px-4"
            type="password"
            autoComplete="current-password"
            placeholder="Password to confirm"
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
              Cancel
            </button>
            <button
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-full border-0 bg-[#7a1f2b] px-4 text-sm font-extrabold text-white"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || password.length < 1}
            >
              {remove.isPending ? "Deleting…" : "Delete permanently"}
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
          Delete account
        </button>
      )}
    </div>
  );
}
