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
import { VerifiedMark } from "../verified-mark";
import styles from "./communities.module.css";

const communitySchema = z
  .object({
    title: z.string().trim().min(3, "At least 3 characters").max(48, "No more than 48 characters"),
    slug: z
      .string()
      .trim()
      .min(3, "At least 3 characters")
      .max(32, "No more than 32 characters")
      .regex(/^[a-z][a-z0-9_-]+$/, "Start with a letter; then Latin letters, digits, _ or -"),
    description: z.string().trim().min(10, "Tell us a little more about the community").max(400),
    is_paid: z.boolean(),
    monthly_price: z.number().int().min(0).max(10000)
  })
  .superRefine((value, context) => {
    if (value.is_paid && value.monthly_price < 5) {
      context.addIssue({ code: "custom", path: ["monthly_price"], message: "From 5 stars per month" });
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
  return error instanceof Error ? error.message : "Couldn't complete the action";
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
          <h1>Communities</h1>
          <p>Topics, authors and spaces worth coming back to</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setCreateOpen(true)}><Plus size={19} /> Create</button>
        <BottomSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="New community"
          description="You can change the name, address and access rules later."
          headerRight={
            <Dialog.Close className={styles.iconButton} aria-label="Close"><X size={20} /></Dialog.Close>
          }
          footer={
            <>
              {createCommunity.isError ? <div className="pb-2"><p className={styles.formError} role="alert">{messageFrom(createCommunity.error)}</p></div> : null}
              {/* The submit control is pinned to the sheet footer, so it reaches the form by id. */}
              <button className={`${styles.primaryButton} w-full`} type="submit" form="create-community-form" disabled={createCommunity.isPending}>
                {createCommunity.isPending ? "Creating…" : "Create community"}
              </button>
            </>
          }
        >
          <div className={styles.dialogHeading}>
            <div>
              <h2>New community</h2>
              <p>You can change the name, address and access rules later.</p>
            </div>
          </div>
          <form
            id="create-community-form"
            className={styles.communityForm}
            onSubmit={form.handleSubmit((values) => createCommunity.mutate(values))}
          >
            <label>
              <span>Name</span>
              <input
                autoFocus
                placeholder="For example, Quiet Typography"
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
              <span>Address</span>
              <span className={styles.slugField}><b>gram.app/</b><input placeholder="quiet_type" {...form.register("slug")} /></span>
              {form.formState.errors.slug ? <small role="alert">{form.formState.errors.slug.message}</small> : null}
            </label>
            <label>
              <span>Description</span>
              <textarea rows={4} placeholder="What this space is about and who it's for" {...form.register("description")} />
              {form.formState.errors.description ? <small role="alert">{form.formState.errors.description.message}</small> : null}
            </label>
            <div className={styles.accessRow}>
              <span>
                <LockKeyhole size={18} />
                <span><strong>Paid access <em>Soon</em></strong><small>Not yet available for new communities</small></span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked="false"
                aria-label="Paid access isn't available yet"
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
            Mine
          </button>
          <button type="button" data-active={scope === "all"} onClick={() => setScope("all")}>
            Browse
          </button>
        </div>
      </div>

      <label className={styles.searchField}>
        <Search size={19} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels"
          aria-label="Search channels"
        />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button> : null}
      </label>

      {communities.isPending ? (
        <div className={styles.directoryLoading} aria-label="Communities are loading"><span /><span /><span /></div>
      ) : communities.isError ? (
        <div className={styles.emptyState}>
          <Users size={30} />
          <strong>Couldn&apos;t load communities</strong>
          <p>{messageFrom(communities.error)}</p>
          <button type="button" onClick={() => communities.refetch()}>Try again</button>
        </div>
      ) : visibleCommunities.length === 0 ? (
        <div className={styles.emptyState}>
          <Search size={30} />
          <strong>{query ? "Nothing found" : "Communities will show up here"}</strong>
          <p>{query ? "Try another search or create a space yourself." : "Create the first space and invite members."}</p>
          {query ? <button type="button" onClick={() => setQuery("")}>Reset search</button> : null}
        </div>
      ) : (
        <section key={scope} className={`panel-enter ${styles.directoryList}`} aria-label="Community directory">
          {visibleCommunities.map((community) => {
            const isMutating = membership.isPending && membership.variables?.slug === community.slug;
            return (
              <article key={community.id} className={styles.communityRow}>
                <Link href={`/c/${community.slug}`} className={styles.communityIdentity}>
                  <CommunityAvatar community={community} />
                  <span className={styles.communityCopy}>
                    <span className={styles.communityName}>
                      {communityTitle(community)}
                      {community.is_verified ? <VerifiedMark size={14} /> : null}
                    </span>
                    <span className={styles.communitySlug}>@{community.slug}</span>
                    <span className={styles.communityDescription}>{community.description}</span>
                    <span className={styles.communityCounts}>
                      <span><Users size={14} /> {community.members_count.toLocaleString("ru-RU")}</span>
                      <span>{community.posts_count.toLocaleString("ru-RU")} posts</span>
                      {community.is_paid ? <span className={styles.paidBadge}><Star size={12} fill="currentColor" /> {community.monthly_price}/mo</span> : null}
                    </span>
                  </span>
                </Link>
                {community.is_owner ? (
                  <button className={styles.ownerButton} type="button" disabled><Check size={16} /> Owner</button>
                ) : (
                  <button
                    className={community.is_member ? styles.memberButton : styles.joinButton}
                    type="button"
                    disabled={isMutating}
                    onClick={() => membership.mutate({ slug: community.slug, joined: community.is_member })}
                  >
                    {isMutating ? "Saving…" : community.is_member ? "Joined" : community.is_paid ? `Join · ${community.monthly_price} ★` : "Join"}
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
