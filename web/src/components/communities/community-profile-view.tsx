"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowLeft, BadgeCheck, CalendarDays, Check, Copy, Crown, FileText, Flag, Gift, Hash, ImageIcon, Link2, MapPin, Share2, Sparkles, Star, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { socialApi } from "@/lib/social-api";
import type { CommunityPerson } from "@/lib/social-types";
import { VerifiedMark } from "../verified-mark";
import { PostCard } from "../feed/post-card";
import { PostComposer } from "../feed/post-composer";
import { CommunityReportSheet } from "../chats/report-sheets";
import { useToast } from "../ui/toast";
import { ChannelManageSheet } from "./channel-manage-sheet";
import { CommunityAvatar, communityTitle } from "./communities-directory";
import styles from "./communities.module.css";



function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}


function PersonAvatar({ person, size = 42 }: { person: CommunityPerson; size?: number }) {
  return (
    <span className={styles.personAvatar} style={{ width: size, height: size }} title={person.display_name}>
      {person.avatar_url ? (
        <span className={styles.avatarImage} style={{ backgroundImage: `url("${person.avatar_url.replace(/["\\\n\r]/g, "")}")` }} />
      ) : null}
      <span className={styles.avatarFallback}>{person.display_name.slice(0, 2).toUpperCase()}</span>
    </span>
  );
}

export function CommunityProfileView({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [managing, setManaging] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [tab, setTab] = useState("posts");
  const community = useQuery({ queryKey: ["community", slug], queryFn: () => socialApi.community(slug) });
  const posts = useQuery({ queryKey: ["community", slug, "posts"], queryFn: () => socialApi.communityPosts(slug) });
  // The channel's own stories, which live on it rather than on the owner's profile.
  const stories = useQuery({
    queryKey: ["community-stories", slug],
    queryFn: () => socialApi.communityStories(slug),
  });

  const membership = useMutation({
    mutationFn: (joined: boolean) => joined ? socialApi.leaveCommunity(slug) : socialApi.joinCommunity(slug),
    onSuccess: async (nextCommunity) => {
      queryClient.setQueryData(["community", slug], nextCommunity);
      await queryClient.invalidateQueries({ queryKey: ["communities"] });
    }
  });

  // Staff can tick a channel. The endpoint refuses everybody else, so the control only appears
  // for the people it would actually work for.
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const verification = useMutation({
    mutationFn: (verified: boolean) => socialApi.setCommunityVerified(slug, verified),
    onSuccess: async (nextCommunity) => {
      queryClient.setQueryData(["community", slug], nextCommunity);
      await queryClient.invalidateQueries({ queryKey: ["communities"] });
      notify(nextCommunity.is_verified ? "Галочка выдана" : "Галочка снята", { variant: "success" });
    },
    onError: (error: unknown) =>
      notify("Не удалось изменить галочку", { variant: "error", detail: messageFrom(error) })
  });


  async function shareCommunity() {
    const url = window.location.href;
    const title = community.data ? communityTitle(community.data) : "Сообщество GRAM";
    let usedNativeShare = false;
    try {
      if (typeof navigator.share === "function") {
        usedNativeShare = true;
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShareNotice(usedNativeShare ? "Ссылка отправлена" : "Ссылка скопирована");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setShareNotice("Не удалось поделиться ссылкой");
    }
  }

  if (community.isPending) {
    return <main className={`${styles.page} ${styles.profilePage}`}><div className={styles.profileLoading}><span /><span /><span /></div></main>;
  }

  if (community.isError) {
    return (
      <main className={`${styles.page} ${styles.profilePage}`}>
        <div className={styles.emptyState}>
          <Users size={30} />
          <strong>Сообщество не открылось</strong>
          <p>{messageFrom(community.error)}</p>
          <button type="button" onClick={() => community.refetch()}>Попробовать снова</button>
          <Link href="/communities">Вернуться в каталог</Link>
        </div>
      </main>
    );
  }

  const item = community.data;
  const title = communityTitle(item);
  const mediaPosts = (posts.data ?? []).filter((post) => post.image_urls?.length || post.media_url);
  // A community publishes as itself: the composer belongs to its owner alone, as on the
  // reference, where a member is offered no composer at all.
  const canPublish = Boolean(item.is_owner);
  const members = item.members ?? (item.owner ? [{ ...item.owner, role: "owner" as const }] : []);
  const cleanCover = item.cover_url?.replace(/["\\\n\r]/g, "");

  return (
    <main className={`${styles.page} ${styles.profilePage}`}>
      <div className={styles.profileTopbar}>
        <Link href="/communities" aria-label="Назад к сообществам"><ArrowLeft size={21} /></Link>
        <span>
          <strong className="inline-flex items-center gap-1">
            {title}
            {item.is_verified ? <VerifiedMark size={14} /> : null}
          </strong>
          <small>{item.posts_count} публикаций</small>
        </span>
        <button type="button" onClick={shareCommunity} aria-label="Поделиться сообществом"><Share2 size={19} /></button>
      </div>

      <section className={styles.communityProfile}>
        <div
          className={styles.communityCover}
          data-seed={item.slug.length % 4}
          style={cleanCover ? { backgroundImage: `linear-gradient(180deg, transparent 15%, rgba(7,8,11,.5)), url("${cleanCover}")` } : undefined}
        />
        <div className={styles.profileIdentityRow}>
          <CommunityAvatar community={item} />
          <div className={styles.profileActions}>
            <button className={styles.shareButton} type="button" onClick={shareCommunity}>
              {shareNotice?.includes("скопирована") ? <Check size={17} /> : <Copy size={17} />}
              {shareNotice ?? "Скопировать ссылку"}
            </button>
            {item.is_owner ? (
              /* The reference gives an owner «Управление» here, not a badge that does nothing. */
              <button
                className={styles.ownerButton}
                type="button"
                onClick={() => setManaging(true)}
              >
                <Crown size={16} /> Управление
              </button>
            ) : (
              <button
                className={item.is_member ? styles.memberButton : styles.joinButton}
                type="button"
                disabled={membership.isPending}
                onClick={() => membership.mutate(item.is_member)}
              >
                {membership.isPending ? "Сохраняем…" : item.is_member ? "Отписаться" : item.is_paid ? `Подписаться · ${item.monthly_price} ★` : "Подписаться"}
              </button>
            )}
            {/* A complaint about somebody else's community, on the same terms as one about a post. */}
            {item.is_owner ? null : (
              <button
                type="button"
                className={styles.reportButton}
                aria-label="Пожаловаться на сообщество"
                title="Пожаловаться на сообщество"
                onClick={() => setReporting(true)}
              >
                <Flag size={16} />
              </button>
            )}
            {/* Staff only: the tick is GRAM's to give, so it is not in the owner's «Управление». */}
            {me.data?.is_admin ? (
              <button
                type="button"
                className={styles.reportButton}
                aria-label={item.is_verified ? "Снять галочку канала" : "Выдать галочку каналу"}
                title={item.is_verified ? "Снять галочку канала" : "Выдать галочку каналу"}
                aria-pressed={item.is_verified}
                disabled={verification.isPending}
                onClick={() => verification.mutate(!item.is_verified)}
              >
                <BadgeCheck size={16} className={item.is_verified ? "text-[var(--primary-strong)]" : undefined} />
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.profileCopy}>
          {/* The tick belongs to the channel, not to whoever owns it. */}
          <h1 className="flex items-center gap-1.5">
            {title}
            {item.is_verified ? <VerifiedMark size={19} /> : null}
          </h1>
          <span>@{item.slug}</span>
          <p>{item.description}</p>
          {item.owner ? (
            <span className={styles.ownerChip}>
              <PersonAvatar person={item.owner} size={28} />
              <span><strong>{item.owner.display_name}</strong><small>Владелец</small></span>
            </span>
          ) : null}
          <div className="mt-3 grid gap-2 text-[0.9rem] text-[var(--muted)]">
            {item.category ? <span className="flex items-center gap-2"><Hash size={15} className="flex-none" />{item.category}</span> : null}
            {item.location ? <span className="flex items-center gap-2"><MapPin size={15} className="flex-none" />{item.location}</span> : null}
            {item.website_url ? (
              <a href={item.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[var(--link)]">
                <Link2 size={15} className="flex-none" />
                {item.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            ) : null}
            <span className="flex items-center gap-2">
              <CalendarDays size={15} className="flex-none" />
              Создан {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.created_at))}
            </span>
          </div>
          <div className={styles.profileMeta}>
            <span><strong>{item.members_count.toLocaleString("ru-RU")}</strong> подписчиков</span>
            <span><strong>{item.posts_count.toLocaleString("ru-RU")}</strong> публикаций</span>
            {item.is_paid ? <span className={styles.paidBadge}><Star size={13} fill="currentColor" /> {item.monthly_price} в месяц</span> : <span>Открытый доступ</span>}
          </div>
        </div>
      </section>

      {membership.isError ? <p className={styles.pageError} role="alert">{messageFrom(membership.error)}</p> : null}

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List
          className="sticky top-0 z-30 mt-4 flex h-[50px] overflow-x-auto border-y border-[var(--line)] bg-[rgba(6,6,8,.95)] px-2 backdrop-blur-xl [scrollbar-width:none]"
          aria-label="Разделы канала"
        >
          <ChannelTab value="posts" label="Посты" />
          <ChannelTab
            value="stories"
            label={stories.data?.length ? `Истории • ${stories.data.length}` : "Истории"}
          />
          <ChannelTab value="media" label={mediaPosts.length ? `Медиа • ${mediaPosts.length}` : "Медиа"} />
          <ChannelTab value="gifts" label="Подарки" />
          <ChannelTab value="about" label="О канале" />
        </Tabs.List>

        <Tabs.Content value="posts" className="outline-none">
      <section className={styles.postsSection} aria-labelledby="community-posts-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="community-posts-title">Публикации</h2><p>Новости и обсуждения пространства</p></div>
          <FileText size={20} />
        </div>

        {canPublish ? (
          <section
            className="border-b border-[var(--line)] px-3 py-3 sm:px-5"
            aria-label="Новая запись канала"
          >
            {/*
              The product's own composer: pictures, a link card and a pasted music link, the
              same as a personal post, because a channel post is a post.
            */}
            <PostComposer
              avatarUrl={item.avatar_url ?? null}
              displayName={title}
              placeholder="Напишите подписчикам канала…"
              communitySlug={slug}
              onPublish={async (content, imageUrls, link, videoUrl, pollOptions, sensitive, file) => {
                await socialApi.createCommunityPost(slug, content, {
                  imageUrls,
                  videoUrl,
                  pollOptions,
                  sensitive,
                  file,
                  link: link ?? undefined
                });
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["community", slug, "posts"] }),
                  queryClient.invalidateQueries({ queryKey: ["community", slug] })
                ]);
              }}
            />
          </section>
        ) : item.is_member ? null : (
          <div className={styles.joinPrompt}>
            <Star size={22} />
            <p>Подпишитесь, чтобы не пропускать публикации канала.</p>
            <button type="button" disabled={membership.isPending} onClick={() => membership.mutate(false)}>
              {item.is_paid ? `Подписаться за ${item.monthly_price} ★` : "Подписаться"}
            </button>
          </div>
        )}

        {posts.isPending ? (
          <div className={styles.postsLoading} aria-label="Публикации загружаются"><span /><span /></div>
        ) : posts.isError ? (
          <div className={styles.inlineLoadError}>
            <span>{messageFrom(posts.error)}</span>
            <button type="button" onClick={() => posts.refetch()}>Повторить</button>
          </div>
        ) : posts.data.length ? (
          <div className="space-y-3 px-3 py-4 sm:px-5">
            {posts.data.map((post) => (
              <PostCard key={post.id} post={post} showPinned />
            ))}
          </div>
        ) : (
          <div className={styles.postsEmpty}>
            <FileText size={25} />
            <strong>Публикаций пока нет</strong>
            <p>{canPublish ? "Начните разговор первой записью." : "Первая запись появится здесь."}</p>
          </div>
        )}
      </section>
        </Tabs.Content>

        <Tabs.Content value="stories" className="outline-none">
          {stories.isPending ? (
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              <div className="skeleton aspect-[3/4] rounded-[16px]" />
              <div className="skeleton aspect-[3/4] rounded-[16px]" />
            </div>
          ) : stories.data?.length ? (
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {stories.data.map((story) => (
                <figure
                  key={story.id}
                  className="m-0 overflow-hidden rounded-[16px] bg-[#121216] bg-cover bg-center"
                >
                  <span
                    role="img"
                    aria-label={story.title}
                    className="block aspect-[3/4] bg-cover bg-center"
                    style={{ backgroundImage: `url("${sanitizeUrl(story.media_url)}")` }}
                  />
                  <figcaption className="truncate px-2 py-1.5 text-[12px] text-[var(--muted)]">
                    {story.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className={styles.postsEmpty}>
              <Sparkles size={25} />
              <strong>Историй пока нет</strong>
              <p>
                {item.is_owner
                  ? "Добавьте историю канала — она будет видна подписчикам."
                  : "Новые истории канала появятся здесь."}
              </p>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="gifts" className="outline-none">
          <div className={styles.postsEmpty}>
            <Gift size={25} />
            <strong>Подарков пока нет</strong>
            <p>
              {item.is_owner
                ? "Подписчики смогут дарить подарки каналу."
                : "Станьте первым, кто подарит подарок каналу."}
            </p>
            {/* Honest about what this button does today: the collectible goes to the owner,
                because a channel cannot yet hold one of its own. */}
            {item.owner && !item.is_owner ? (
              <Link className={styles.joinButton} href={`/u/${item.owner.username}?gift=1`}>
                Подарить владельцу
              </Link>
            ) : null}
          </div>
        </Tabs.Content>

        <Tabs.Content value="media" className="outline-none">
          {mediaPosts.length ? (
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {mediaPosts.map((post) => (
                <span
                  key={post.id}
                  role="img"
                  aria-label={`Медиа публикации: ${post.content.slice(0, 60)}`}
                  className="block aspect-square rounded-[16px] bg-[#121216] bg-cover bg-center"
                  style={{ backgroundImage: `url("${sanitizeUrl(post.image_urls?.[0] ?? post.media_url ?? "")}")` }}
                />
              ))}
            </div>
          ) : (
            <div className={styles.postsEmpty}>
              <ImageIcon size={25} />
              <strong>Медиа пока нет</strong>
              <p>Изображения из публикаций канала появятся здесь.</p>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="about" className="outline-none">
          <div className="px-3 py-4 sm:px-4">
            <p className="mb-0 text-[0.95rem] leading-6 text-[#e7e9ea]">
              {item.description || "Владелец пока не добавил описание канала."}
            </p>
          </div>
      <section className={styles.membersSection} aria-labelledby="members-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="members-title">Подписчики</h2><p>{item.members_count.toLocaleString("ru-RU")} человек на канале</p></div>
          <Users size={20} />
        </div>
        {members.length ? (
          <div className={styles.memberStrip}>
            {members.slice(0, 8).map((member) => (
              <Link href={`/u/${member.username}`} key={member.id ?? member.username}>
                <PersonAvatar person={member} size={48} />
                <span>{member.display_name}</span>
                <small>{member.role === "owner" ? "Владелец" : member.role === "admin" ? "Админ" : `@${member.username}`}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.membersUnavailable}>Состав участников появится после первого вступления.</p>
        )}
      </section>

        </Tabs.Content>
      </Tabs.Root>

      {item.is_owner ? (
        <ChannelManageSheet community={item} open={managing} onOpenChange={setManaging} />
      ) : (
        <CommunityReportSheet
          slug={item.slug}
          title={title}
          open={reporting}
          onOpenChange={setReporting}
        />
      )}
    </main>
  );
}

/** Background images come from user input, so only URL-safe characters survive. */
function sanitizeUrl(value: string) {
  return value.replace(/[^A-Za-z0-9\-._~:/?#@!$&()*+,;=%]/g, "");
}

function ChannelTab({ value, label }: { value: string; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className="relative flex min-w-[104px] flex-1 items-center justify-center border-0 bg-transparent px-3 text-[0.82rem] font-bold text-[var(--muted)] after:absolute after:inset-x-5 after:bottom-0 after:h-[3px] after:scale-x-0 after:rounded-full after:bg-[var(--primary-strong)] after:transition-transform data-[state=active]:text-white data-[state=active]:after:scale-x-100"
    >
      <span className="whitespace-nowrap">{label}</span>
    </Tabs.Trigger>
  );
}
