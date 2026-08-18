"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LockKeyhole, Plus, Search, Star, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { socialApi } from "@/lib/social-api";
import type { Community } from "@/lib/social-types";
import { BottomSheet } from "../ui/bottom-sheet";
import styles from "./communities.module.css";

const communitySchema = z
  .object({
    title: z.string().trim().min(3, "Минимум 3 символа").max(48, "Не больше 48 символов"),
    slug: z
      .string()
      .trim()
      .min(3, "Минимум 3 символа")
      .max(32, "Не больше 32 символов")
      .regex(/^[a-z][a-z0-9_-]+$/, "Начните с буквы; дальше — латиница, цифры, _ или -"),
    description: z.string().trim().min(10, "Расскажите о сообществе чуть подробнее").max(400),
    is_paid: z.boolean(),
    monthly_price: z.number().int().min(0).max(10000)
  })
  .superRefine((value, context) => {
    if (value.is_paid && value.monthly_price < 5) {
      context.addIssue({ code: "custom", path: ["monthly_price"], message: "От 5 звёзд в месяц" });
    }
  });

type CommunityForm = z.infer<typeof communitySchema>;

export function communityTitle(community: Community) {
  return community.title || community.name;
}

export function CommunityAvatar({ community, size = "large" }: { community: Community; size?: "small" | "large" }) {
  const title = communityTitle(community);
  return (
    <span className={styles.avatar} data-size={size} data-seed={community.slug.length % 4}>
      {community.avatar_url ? <span className={styles.avatarImage} style={{ backgroundImage: `url("${community.avatar_url.replace(/["\\\n\r]/g, "")}")` }} /> : null}
      <span className={styles.avatarFallback}>{title.slice(0, 2).toUpperCase()}</span>
    </span>
  );
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

export function CommunitiesDirectory() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [createOpen, setCreateOpen] = useState(params.get("create") === "1");
  const deferredQuery = useDeferredValue(query);

  const communities = useQuery({ queryKey: ["communities"], queryFn: () => socialApi.communities() });

  const membership = useMutation({
    mutationFn: ({ slug, joined }: { slug: string; joined: boolean }) =>
      joined ? socialApi.leaveCommunity(slug) : socialApi.joinCommunity(slug),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["communities"] });
    }
  });

  const form = useForm<CommunityForm>({
    resolver: zodResolver(communitySchema),
    defaultValues: {
      title: "",
      slug: "",
      description: "",
      is_paid: false,
      monthly_price: 25
    }
  });

  const createCommunity = useMutation({
    mutationFn: socialApi.createCommunity,
    onSuccess: async (community) => {
      await queryClient.invalidateQueries({ queryKey: ["communities"] });
      setCreateOpen(false);
      form.reset();
      router.push(`/c/${community.slug}`);
    }
  });

  const visibleCommunities = useMemo(() => {
    const scoped = (communities.data ?? []).filter(
      (community) => scope === "all" || community.is_member || community.is_owner
    );
    const needle = deferredQuery.trim().toLocaleLowerCase("ru-RU").replace(/^@/, "");
    if (!needle) return scoped;
    return scoped.filter((community) =>
      `${communityTitle(community)} ${community.slug} ${community.description}`
        .toLocaleLowerCase("ru-RU")
        .includes(needle)
    );
  }, [communities.data, deferredQuery, scope]);

  return (
    <main className={styles.page}>
      <header className={styles.directoryHeader}>
        <div>
          <h1>Сообщества</h1>
          <p>Темы, авторы и пространства, к которым хочется возвращаться</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setCreateOpen(true)}><Plus size={19} /> Создать</button>
        <BottomSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="Новое сообщество"
          description="Название, адрес и правила доступа можно изменить позже."
          headerRight={
            <Dialog.Close className={styles.iconButton} aria-label="Закрыть"><X size={20} /></Dialog.Close>
          }
          footer={
            <>
              {createCommunity.isError ? <div className="pb-2"><p className={styles.formError} role="alert">{messageFrom(createCommunity.error)}</p></div> : null}
              {/* The submit control is pinned to the sheet footer, so it reaches the form by id. */}
              <button className={`${styles.primaryButton} w-full`} type="submit" form="create-community-form" disabled={createCommunity.isPending}>
                {createCommunity.isPending ? "Создаём…" : "Создать сообщество"}
              </button>
            </>
          }
        >
          <div className={styles.dialogHeading}>
            <div>
              <h2>Новое сообщество</h2>
              <p>Название, адрес и правила доступа можно изменить позже.</p>
            </div>
          </div>
          <form
            id="create-community-form"
            className={styles.communityForm}
            onSubmit={form.handleSubmit((values) => createCommunity.mutate(values))}
          >
            <label>
              <span>Название</span>
              <input
                autoFocus
                placeholder="Например, Тихая типографика"
                aria-invalid={Boolean(form.formState.errors.title)}
                {...form.register("title", {
                  onChange: (event) => {
                    if (!form.formState.dirtyFields.slug) {
                      form.setValue(
                        "slug",
                        event.target.value
                          .toLowerCase()
                          .replace(/\s+/g, "_")
                          .replace(/[^a-z0-9_]/g, "")
                          .slice(0, 32)
                      );
                    }
                  }
                })}
              />
              {form.formState.errors.title ? <small role="alert">{form.formState.errors.title.message}</small> : null}
            </label>
            <label>
              <span>Адрес</span>
              <span className={styles.slugField}><b>gram.app/</b><input placeholder="quiet_type" {...form.register("slug")} /></span>
              {form.formState.errors.slug ? <small role="alert">{form.formState.errors.slug.message}</small> : null}
            </label>
            <label>
              <span>Описание</span>
              <textarea rows={4} placeholder="О чём это пространство и для кого оно создано" {...form.register("description")} />
              {form.formState.errors.description ? <small role="alert">{form.formState.errors.description.message}</small> : null}
            </label>
            <div className={styles.accessRow}>
              <span>
                <LockKeyhole size={18} />
                <span><strong>Платный доступ <em>Скоро</em></strong><small>Для новых сообществ пока недоступен</small></span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked="false"
                aria-label="Платный доступ пока недоступен"
                className={styles.switch}
                disabled
              ><i /></button>
            </div>
          </form>
        </BottomSheet>
      </header>

      <div className="mx-auto mb-3 w-full max-w-[720px] px-1">
        <div className="segmented-control">
          <button type="button" data-active={scope === "mine"} onClick={() => setScope("mine")}>
            Мои
          </button>
          <button type="button" data-active={scope === "all"} onClick={() => setScope("all")}>
            Обзор
          </button>
        </div>
      </div>

      <label className={styles.searchField}>
        <Search size={19} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск каналов"
          aria-label="Поиск каналов"
        />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={17} /></button> : null}
      </label>

      {communities.isPending ? (
        <div className={styles.directoryLoading} aria-label="Сообщества загружаются"><span /><span /><span /></div>
      ) : communities.isError ? (
        <div className={styles.emptyState}>
          <Users size={30} />
          <strong>Не удалось загрузить сообщества</strong>
          <p>{messageFrom(communities.error)}</p>
          <button type="button" onClick={() => communities.refetch()}>Попробовать снова</button>
        </div>
      ) : visibleCommunities.length === 0 ? (
        <div className={styles.emptyState}>
          <Search size={30} />
          <strong>{query ? "Ничего не найдено" : "Здесь появятся сообщества"}</strong>
          <p>{query ? "Попробуйте другой запрос или создайте пространство сами." : "Создайте первое пространство и пригласите участников."}</p>
          {query ? <button type="button" onClick={() => setQuery("")}>Сбросить поиск</button> : null}
        </div>
      ) : (
        <section className={styles.directoryList} aria-label="Каталог сообществ">
          {visibleCommunities.map((community) => {
            const isMutating = membership.isPending && membership.variables?.slug === community.slug;
            return (
              <article key={community.id} className={styles.communityRow}>
                <Link href={`/c/${community.slug}`} className={styles.communityIdentity}>
                  <CommunityAvatar community={community} />
                  <span className={styles.communityCopy}>
                    <span className={styles.communityName}>{communityTitle(community)}</span>
                    <span className={styles.communitySlug}>@{community.slug}</span>
                    <span className={styles.communityDescription}>{community.description}</span>
                    <span className={styles.communityCounts}>
                      <span><Users size={14} /> {community.members_count.toLocaleString("ru-RU")}</span>
                      <span>{community.posts_count.toLocaleString("ru-RU")} публикаций</span>
                      {community.is_paid ? <span className={styles.paidBadge}><Star size={12} fill="currentColor" /> {community.monthly_price}/мес</span> : null}
                    </span>
                  </span>
                </Link>
                {community.is_owner ? (
                  <button className={styles.ownerButton} type="button" disabled><Check size={16} /> Владелец</button>
                ) : (
                  <button
                    className={community.is_member ? styles.memberButton : styles.joinButton}
                    type="button"
                    disabled={isMutating}
                    onClick={() => membership.mutate({ slug: community.slug, joined: community.is_member })}
                  >
                    {isMutating ? "Сохраняем…" : community.is_member ? "Вы участник" : community.is_paid ? `Вступить · ${community.monthly_price} ★` : "Вступить"}
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
      {membership.isError ? <p className={styles.pageError} role="alert">{messageFrom(membership.error)}</p> : null}
    </main>
  );
}
