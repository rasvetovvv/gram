"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { socialApi } from "@/lib/social-api";
import type { Community } from "@/lib/social-types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * «Управление» — what a channel's owner can actually change: how it introduces itself, and one
 * more story for its strip.
 *
 * The slug is deliberately absent: it is the channel's address, and links already point at it.
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
      queryClient.invalidateQueries({ queryKey: ["communities"] })
    ]);

  const save = useMutation({
    mutationFn: () => socialApi.updateCommunity(community.slug, form),
    onSuccess: async () => {
      await refresh();
      notify("Канал обновлён", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось сохранить", { variant: "error", detail: error.message })
  });

  const publishStory = useMutation({
    mutationFn: () =>
      socialApi.createCommunityStory(community.slug, story.title.trim(), story.media_url.trim()),
    onSuccess: async () => {
      setStory({ title: "", media_url: "" });
      await refresh();
      notify("История канала опубликована", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось опубликовать", { variant: "error", detail: error.message })
  });

  const fields: { key: keyof typeof form; label: string; placeholder: string }[] = [
    { key: "title", label: "Название", placeholder: "Как называется канал" },
    { key: "description", label: "Описание", placeholder: "О чём этот канал" },
    { key: "category", label: "Категория", placeholder: "Например: дизайн" },
    { key: "location", label: "Город", placeholder: "Город или страна" },
    { key: "website_url", label: "Сайт", placeholder: "https://" }
  ];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Управление каналом"
      description="Название, описание и истории канала"
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={save.isPending || !form.title.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Управление каналом</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Адрес канала — @{community.slug}, он не меняется: на него уже ведут ссылки.
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
            <Sparkles size={16} className="text-[var(--primary-strong)]" />
            История канала
          </span>
          <span className="text-[12px] leading-4 text-[var(--muted)]">
            Появится в разделе «Истории» и будет видна подписчикам.
          </span>
          <input
            className="field px-4"
            value={story.title}
            maxLength={120}
            placeholder="Подпись"
            aria-label="Подпись истории"
            onChange={(event) => setStory({ ...story, title: event.target.value })}
          />
          <input
            className="field px-4"
            value={story.media_url}
            inputMode="url"
            placeholder="https://…/picture.jpg"
            aria-label="Ссылка на изображение истории"
            onChange={(event) => setStory({ ...story, media_url: event.target.value })}
          />
          <button
            type="button"
            className="quiet-button w-full"
            disabled={!story.title.trim() || !story.media_url.trim() || publishStory.isPending}
            onClick={() => publishStory.mutate()}
          >
            {publishStory.isPending ? "Публикуем…" : "Добавить историю канала"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
