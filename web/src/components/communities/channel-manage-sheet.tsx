"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Hash, Sparkles, Star, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { socialApi } from "@/lib/social-api";
import type { Community } from "@/lib/social-types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * "Management" — what a channel's owner can actually change: how it introduces itself, which
 * handles open it, and one more story for its strip.
 *
 * A channel's addresses come out of the same pool people's accounts draw from, so this is where
 * a handle bought on the market becomes a way in.
 */
export function ChannelManageSheet({
  community,
  open,
  onOpenChange
}: {
  community: Community;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [form, setForm] = useState({
    title: community.title ?? community.name,
    description: community.description ?? "",
    category: community.category ?? "",
    location: community.location ?? "",
    website_url: community.website_url ?? ""
  });
  const [story, setStory] = useState({ title: "", media_url: "" });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["community", community.slug] }),
      queryClient.invalidateQueries({ queryKey: ["community-stories", community.slug] }),
      queryClient.invalidateQueries({ queryKey: ["communities"] }),
      queryClient.invalidateQueries({ queryKey: ["my-communities"] }),
      queryClient.invalidateQueries({ queryKey: ["usernames"] })
    ]);

  // Handles this account owns and has not given to anything yet: the pool a channel can take a
  // second address from.
  const handles = useQuery({
    queryKey: ["usernames"],
    queryFn: api.usernames,
    enabled: open && community.is_owner
  });
  const attachable = (handles.data ?? []).filter(
    (item) => item.is_owned_by_me && !item.community_slug && !item.is_primary_handle
  );
  const attached = (handles.data ?? []).filter((item) => item.community_slug === community.slug);
  const addresses = community.usernames ?? [community.slug];

  const attach = useMutation({
    mutationFn: (username: string) => api.attachCommunityUsername(community.slug, username),
    onSuccess: async (updated, username) => {
      await refresh();
      notify(`@${username} now opens "${updated.title}"`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't link the name", { variant: "error", detail: error.message })
  });
  const detach = useMutation({
    mutationFn: (assetId: string) => api.detachCommunityUsername(community.slug, assetId),
    onSuccess: async () => {
      await refresh();
      notify("Name unlinked from the channel", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't unlink", { variant: "error", detail: error.message })
  });
  const makePrimary = useMutation({
    mutationFn: (assetId: string) => api.setCommunityPrimaryUsername(community.slug, assetId),
    onSuccess: async (updated) => {
      await refresh();
      notify(`The channel opens at @${updated.slug}`, {
        variant: "success",
        detail: "The previous address still works if it is also a username"
      });
    },
    onError: (error: Error) =>
      notify("Couldn't change the address", { variant: "error", detail: error.message })
  });

  const save = useMutation({
    mutationFn: () => socialApi.updateCommunity(community.slug, form),
    onSuccess: async () => {
      await refresh();
      notify("Channel updated", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't save", { variant: "error", detail: error.message })
  });

  const publishStory = useMutation({
    mutationFn: () =>
      socialApi.createCommunityStory(community.slug, story.title.trim(), story.media_url.trim()),
    onSuccess: async () => {
      setStory({ title: "", media_url: "" });
      await refresh();
      notify("Channel story published", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't publish", { variant: "error", detail: error.message })
  });

  const fields: { key: keyof typeof form; label: string; placeholder: string }[] = [
    { key: "title", label: "Name", placeholder: "What the channel is called" },
    { key: "description", label: "Description", placeholder: "What this channel is about" },
    { key: "category", label: "Category", placeholder: "For example: design" },
    { key: "location", label: "City", placeholder: "City or country" },
    { key: "website_url", label: "Website", placeholder: "https://" }
  ];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Channel management"
      description="Channel name, description and stories"
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={save.isPending || !form.title.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Channel management</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          The channel opens at @{community.slug}. Account and channel names share one space:
          a channel&apos;s address cannot be taken as a username, or the reverse.
        </p>

        <div className="grid gap-3">
          {fields.map((field) => (
            <label key={field.key} className="grid gap-1.5">
              <span className="text-[0.95rem] font-bold">{field.label}</span>
              <input
                className="field px-4"
                value={form[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="mt-5 grid gap-2 rounded-[16px] bg-[var(--surface-raised)] p-3">
          <span className="flex items-center gap-2 text-[0.95rem] font-bold">
            <AtSign size={16} className="text-[var(--link)]" />
            Channel addresses
          </span>
          <span className="text-[12px] leading-4 text-[var(--muted)]">
            The first is primary — the channel opens at it by default. The rest work too.
          </span>
          <div className="grid gap-1.5">
            {addresses.map((handle, index) => {
              const asset = attached.find((item) => item.username === handle);
              return (
                <div
                  key={handle}
                  className="flex min-h-11 items-center gap-2 rounded-[12px] bg-[#1f1f24] px-3"
                >
                  <Hash size={14} className="flex-none text-[var(--muted)]" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    @{handle}
                    {index === 0 ? (
                      <span className="ml-2 rounded-full bg-[#1b2a3a] px-1.5 py-0.5 text-[0.58rem] font-extrabold text-[var(--link)]">
                        PRIMARY
                      </span>
                    ) : null}
                  </span>
                  {asset && index !== 0 ? (
                    <>
                      <button
                        type="button"
                        className="flex-none border-0 bg-transparent p-0 text-[12px] font-bold text-[var(--link)]"
                        disabled={makePrimary.isPending}
                        onClick={() => makePrimary.mutate(asset.id)}
                      >
                        make primary
                      </button>
                      <button
                        type="button"
                        aria-label={`Unlink @${handle}`}
                        className="grid size-7 flex-none place-items-center rounded-full text-[var(--muted)] transition hover:bg-white/10"
                        disabled={detach.isPending}
                        onClick={() => detach.mutate(asset.id)}
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          {community.is_owner ? (
            attachable.length ? (
              <>
                <span className="mt-1 text-[12px] font-bold text-[var(--muted)]">
                  Add from your names
                </span>
                <div className="grid gap-1.5">
                  {attachable.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex min-h-11 items-center gap-2 rounded-[12px] bg-[#1f1f24] px-3 text-left transition hover:brightness-125"
                      disabled={attach.isPending || item.status === "listed"}
                      onClick={() => attach.mutate(item.username)}
                    >
                      <AtSign size={14} className="flex-none text-[var(--link)]" />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        @{item.username}
                      </span>
                      {item.status === "listed" ? (
                        <span className="flex-none text-[11px] font-bold text-[var(--stars)]">
                          <Star size={11} className="mr-1 inline" fill="currentColor" />
                          remove from sale
                        </span>
                      ) : (
                        <span className="flex-none text-[12px] font-bold text-[var(--link)]">
                          link
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-[12px] leading-4 text-[var(--dim)]">
                No free names — claim or buy a username on the market and it will appear here.
              </span>
            )
          ) : null}
        </div>

        <div className="mt-5 grid gap-2 rounded-[16px] bg-[var(--surface-raised)] p-3">
          <span className="flex items-center gap-2 text-[0.95rem] font-bold">
            <Sparkles size={16} className="text-[var(--primary-strong)]" />
            Channel story
          </span>
          <span className="text-[12px] leading-4 text-[var(--muted)]">
            It will appear in the &quot;Stories&quot; section and be visible to subscribers.
          </span>
          <input
            className="field px-4"
            value={story.title}
            maxLength={120}
            placeholder="Caption"
            aria-label="Story caption"
            onChange={(event) => setStory({ ...story, title: event.target.value })}
          />
          <input
            className="field px-4"
            value={story.media_url}
            inputMode="url"
            placeholder="https://…/picture.jpg"
            aria-label="Story image link"
            onChange={(event) => setStory({ ...story, media_url: event.target.value })}
          />
          <button
            type="button"
            className="quiet-button w-full"
            disabled={!story.title.trim() || !story.media_url.trim() || publishStory.isPending}
            onClick={() => publishStory.mutate()}
          >
            {publishStory.isPending ? "Publishing…" : "Add channel story"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
