"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowLeft, BadgeCheck, CalendarDays, Check, Copy, Crown, FileText, Flag, Gift, Hash, ImageIcon, Link2, MapPin, Share2, Sparkles, Star, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { socialApi } from "@/lib/social-api";
import type { CommunityPerson } from "@/lib/social-types";
import { plural } from "@/lib/utils";
import { VerifiedMark } from "../verified-mark";
import { PostCard } from "../feed/post-card";
import { PostComposer } from "../feed/post-composer";
import { CommunityReportSheet } from "../chats/report-sheets";
import { StaffCommunityControls } from "../admin/staff-controls";
import { useToast } from "../ui/toast";
import { ChannelManageSheet } from "./channel-manage-sheet";
import { CommunityAvatar, communityTitle } from "./communities-directory";
import styles from "./communities.module.css";



function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Couldn't complete the action";
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
  const router = useRouter();
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

  /*
   * A channel opened by one of its extra handles moves to its own address.
   *
   * The API answers to every handle, but everything that later refreshes this page — attaching an
   * address, joining, publishing — invalidates the canonical key. Left on an alias, the page kept
   * showing what the channel looked like before the change.
   */
  const canonical = community.data?.slug;
  useEffect(() => {
    if (canonical && canonical !== slug) router.replace(`/c/${canonical}`);
  }, [canonical, router, slug]);

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
      notify(nextCommunity.is_verified ? "Verification granted" : "Verification removed", { variant: "success" });
    },
    onError: (error: unknown) =>
      notify("Couldn't change verification", { variant: "error", detail: messageFrom(error) })
  });


  async function shareCommunity() {
    const url = window.location.href;
    const title = community.data ? communityTitle(community.data) : "GRAM community";
    let usedNativeShare = false;
    try {
      if (typeof navigator.share === "function") {
        usedNativeShare = true;
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShareNotice(usedNativeShare ? "Link shared" : "Link copied");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setShareNotice("Couldn't share the link");
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
          <strong>Couldn&apos;t open the community</strong>
          <p>{messageFrom(community.error)}</p>
          <button type="button" onClick={() => community.refetch()}>Try again</button>
          <Link href="/communities">Back to the directory</Link>
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
        <Link href="/communities" aria-label="Back to communities"><ArrowLeft size={21} /></Link>
        <span>
          <strong className="inline-flex items-center gap-1">
            {title}
            {item.is_verified ? <VerifiedMark size={14} /> : null}
          </strong>
          <small>{item.posts_count} posts</small>
        </span>
        <button type="button" onClick={shareCommunity} aria-label="Share community"><Share2 size={19} /></button>
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
              {shareNotice?.includes("copied") ? <Check size={17} /> : <Copy size={17} />}
              {shareNotice ?? "Copy link"}
            </button>
            {item.is_owner ? (
              /* The reference gives an owner “Manage” here, not a badge that does nothing. */
              <button
                className={styles.ownerButton}
                type="button"
                onClick={() => setManaging(true)}
              >
                <Crown size={16} /> Manage
              </button>
            ) : (
              <button
                className={item.is_member ? styles.memberButton : styles.joinButton}
                type="button"
                disabled={membership.isPending}
                onClick={() => membership.mutate(item.is_member)}
              >
                {membership.isPending ? "Saving…" : item.is_member ? "Unsubscribe" : item.is_paid ? `Subscribe · ${item.monthly_price} ★` : "Subscribe"}
              </button>
            )}
            {/* A complaint about somebody else's community, on the same terms as one about a post. */}
            {item.is_owner ? null : (
              <button
                type="button"
                className={styles.reportButton}
                aria-label="Report community"
                title="Report community"
                onClick={() => setReporting(true)}
              >
                <Flag size={16} />
              </button>
            )}
            {/* Staff only: the tick is GRAM's to give, so it is not in the owner's “Manage”. */}
            {me.data?.is_admin ? (
              <button
                type="button"
                className={styles.reportButton}
                aria-label={item.is_verified ? "Remove channel verification" : "Grant channel verification"}
                title={item.is_verified ? "Remove channel verification" : "Grant channel verification"}
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
          {/* Extra addresses, written the way a profile writes its own: the channel answers to
              every one of them, and a reader should be able to see which. */}
          {(item.usernames ?? []).filter((handle) => handle !== item.slug).length ? (
            <span className="mt-0.5 block text-[0.85rem] leading-5 text-[var(--muted)]">
              also{" "}
              {(item.usernames ?? [])
                .filter((handle) => handle !== item.slug)
                .map((handle, index) => (
                  <span key={handle}>
                    {index ? ", " : ""}
                    <Link href={`/c/${handle}`} className="font-semibold text-[var(--link)]">
                      @{handle}
                    </Link>
                  </span>
                ))}
            </span>
          ) : null}
          <p>{item.description}</p>
          {item.owner ? (
            <span className={styles.ownerChip}>
              <PersonAvatar person={item.owner} size={28} />
              <span><strong>{item.owner.display_name}</strong><small>Owner</small></span>
            </span>
          ) : null}
          {/* Staff decisions about the community itself, without a trip to the panel. */}
          <StaffCommunityControls
            slug={item.slug}
            title={title}
            ownerUsername={item.owner?.username}
          />
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
              Created {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.created_at))}
            </span>
          </div>
          <div className={styles.profileMeta}>
            <span><strong>{item.members_count.toLocaleString("ru-RU")}</strong> {plural(item.members_count, "subscriber", "subscribers", "subscribers")}</span>
            <span><strong>{item.posts_count.toLocaleString("ru-RU")}</strong> {plural(item.posts_count, "post", "posts", "posts")}</span>
            {item.is_paid ? <span className={styles.paidBadge}><Star size={13} fill="currentColor" /> {item.monthly_price} per month</span> : <span>Open access</span>}
          </div>
        </div>
      </section>

      {membership.isError ? <p className={styles.pageError} role="alert">{messageFrom(membership.error)}</p> : null}

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List
          className="sticky top-0 z-30 mt-4 flex h-[50px] overflow-x-auto border-y border-[var(--line)] bg-[rgba(6,6,8,.95)] px-2 backdrop-blur-xl [scrollbar-width:none]"
          aria-label="Channel sections"
        >
          <ChannelTab value="posts" label="Posts" />
          <ChannelTab
            value="stories"
            label={stories.data?.length ? `Stories • ${stories.data.length}` : "Stories"}
          />
          <ChannelTab value="media" label={mediaPosts.length ? `Media • ${mediaPosts.length}` : "Media"} />
          <ChannelTab value="gifts" label="Gifts" />
          <ChannelTab value="about" label="About" />
        </Tabs.List>

        <Tabs.Content value="posts" className="panel-enter outline-none">
      <section className={styles.postsSection} aria-labelledby="community-posts-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="community-posts-title">Posts</h2><p>News and discussions from the space</p></div>
          <FileText size={20} />
        </div>

        {canPublish ? (
          <section
            className="border-b border-[var(--line)] px-3 py-3 sm:px-5"
            aria-label="New channel post"
          >
            {/*
              The product's own composer: pictures, a link card and a pasted music link, the
              same as a personal post, because a channel post is a post.
            */}
            <PostComposer
              avatarUrl={item.avatar_url ?? null}
              displayName={title}
              placeholder="Write to the channel's subscribers…"
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
            <p>Subscribe so you don&apos;t miss the channel&apos;s posts.</p>
            <button type="button" disabled={membership.isPending} onClick={() => membership.mutate(false)}>
              {item.is_paid ? `Subscribe for ${item.monthly_price} ★` : "Subscribe"}
            </button>
          </div>
        )}

        {posts.isPending ? (
          <div className={styles.postsLoading} aria-label="Posts are loading"><span /><span /></div>
        ) : posts.isError ? (
          <div className={styles.inlineLoadError}>
            <span>{messageFrom(posts.error)}</span>
            <button type="button" onClick={() => posts.refetch()}>Retry</button>
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
            <strong>No posts yet</strong>
            <p>{canPublish ? "Start the conversation with the first post." : "The first post will appear here."}</p>
          </div>
        )}
      </section>
        </Tabs.Content>

        <Tabs.Content value="stories" className="panel-enter outline-none">
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
              <strong>No stories yet</strong>
              <p>
                {item.is_owner
                  ? "Add a channel story — subscribers will see it."
                  : "New channel stories will appear here."}
              </p>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="gifts" className="panel-enter outline-none">
          <div className={styles.postsEmpty}>
            <Gift size={25} />
            <strong>No gifts yet</strong>
            <p>
              {item.is_owner
                ? "Subscribers will be able to send gifts to the channel."
                : "Be the first to send a gift to the channel."}
            </p>
            {/* Honest about what this button does today: the collectible goes to the owner,
                because a channel cannot yet hold one of its own. */}
            {item.owner && !item.is_owner ? (
              <Link className={styles.joinButton} href={`/u/${item.owner.username}?gift=1`}>
Gift the owner
              </Link>
            ) : null}
          </div>
        </Tabs.Content>

        <Tabs.Content value="media" className="panel-enter outline-none">
          {mediaPosts.length ? (
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {mediaPosts.map((post) => (
                <span
                  key={post.id}
                  role="img"
                  aria-label={`Post media: ${post.content.slice(0, 60)}`}
                  className="block aspect-square rounded-[16px] bg-[#121216] bg-cover bg-center"
                  style={{ backgroundImage: `url("${sanitizeUrl(post.image_urls?.[0] ?? post.media_url ?? "")}")` }}
                />
              ))}
            </div>
          ) : (
            <div className={styles.postsEmpty}>
              <ImageIcon size={25} />
              <strong>No media yet</strong>
              <p>Images from the channel&apos;s posts will appear here.</p>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="about" className="panel-enter outline-none">
          <div className="px-3 py-4 sm:px-4">
            <p className="mb-0 text-[0.95rem] leading-6 text-[#e7e9ea]">
              {item.description || "The owner hasn't added a channel description yet."}
            </p>
          </div>
      <section className={styles.membersSection} aria-labelledby="members-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="members-title">Subscribers</h2><p>{item.members_count.toLocaleString("ru-RU")} people in the channel</p></div>
          <Users size={20} />
        </div>
        {members.length ? (
          <div className={styles.memberStrip}>
            {members.slice(0, 8).map((member) => (
              <Link href={`/u/${member.username}`} key={member.id ?? member.username}>
                <PersonAvatar person={member} size={48} />
                <span>{member.display_name}</span>
                <small>{member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : `@${member.username}`}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.membersUnavailable}>The member list will appear after the first person joins.</p>
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
