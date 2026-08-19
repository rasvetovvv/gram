"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Camera,
  Check,
  Code2,
  FileText,
  Film,
  ImagePlus,
  Link2,
  MoreHorizontal,
  Music2,
  Paperclip,
  Plus,
  Save,
  ShieldAlert,
  Smile,
  X
} from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

const MAX_LENGTH = 560;
const MAX_IMAGES = 4;
/** What the server recognises as a track, so the field can tell a link from a paste of text. */
const MUSIC_LINK = /https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/\S+/i;
/** The server's own bounds for a poll, so the composer cannot offer what it would refuse. */
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;

const EMOJI = ["🙂", "😂", "🔥", "❤️", "👍", "🎉", "✨", "😮", "😢", "🙏", "👀", "💯", "🌙", "☕", "📷", "🎧"];

/** The reference's "Ещё" menu. Only the surfaces GRAM actually supports are enabled. */
/** What the menu still cannot do, and says so rather than pretending. */
const MORE_SOON = [
  { icon: Paperclip, label: "Прикрепить файл" },
  { icon: Save, label: "Сохранить черновик" },
  { icon: FileText, label: "Черновики" }
];

/**
 * Inline composer, following the reference: a borderless growing input at 17px, a divider,
 * then a scrollable row of 32/36px round icon actions with the publish pill pinned right.
 *
 * A textarea stands in for the reference's contenteditable — it renders identically once it
 * grows with its content, and avoids the paste and caret handling that rich input needs.
 */
export function PostComposer({
  avatarUrl,
  displayName,
  placeholder = "Что нового?",
  onPublished,
  onPublish
}: {
  avatarUrl?: string | null;
  displayName?: string;
  placeholder?: string;
  onPublished?: () => void;
  /**
   * Where the post goes, when it is not the author's own feed. A channel takes the same text,
   * pictures and link — the destination is the only difference, so it is the only parameter.
   */
  onPublish?: (
    content: string,
    imageUrls: string[],
    link: { url?: string; title?: string } | null | undefined,
    videoUrl: string | null,
    pollOptions: string[] | null,
    sensitive: boolean
  ) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  // Uploaded up front, so the author sees the real picture and can drop it before publishing.
  const [pictures, setPictures] = useState<string[]>([]);
  // One outbound link, shown as a card and confirmed before a reader follows it.
  const [link, setLink] = useState<{ url: string; title: string } | null>(null);
  /*
   * One clip, uploaded up front like the pictures. Pictures and a clip are exclusive: a post
   * that carried both would have to choose which to draw, and the reference never asks.
   */
  const [video, setVideo] = useState<string | null>(null);
  const videoPicker = useRef<HTMLInputElement>(null);
  /*
   * A poll's answers. Two are the minimum the server accepts and four the maximum; the question
   * is the post's own text, as in the reference, so there is no separate title to fill in.
   */
  const [poll, setPoll] = useState<string[] | null>(null);
  /*
   * The author's own 18+ mark. Nothing infers it from the pictures: a cover that appears by
   * itself would be a guess about someone else's work.
   */
  const [sensitive, setSensitive] = useState(false);
  // Same picker, asking the phone for its camera instead of its library.
  const camera = useRef<HTMLInputElement>(null);
  /*
   * A track is attached by putting its link in the text: the server resolves it and the card
   * draws the cover, the title and the artist. This row is only a place to paste one, so the
   * author does not have to know that the link is what does the work.
   */
  const [trackField, setTrackField] = useState(false);

  const upload = useMutation({
    mutationFn: (files: File[]) =>
      Promise.all(files.slice(0, MAX_IMAGES - pictures.length).map((file) => api.uploadPostMedia(file))),
    onSuccess: (uploaded) =>
      setPictures((current) => [...current, ...uploaded.map((item) => item.url)].slice(0, MAX_IMAGES)),
    onError: (error: Error) =>
      notify("Не удалось загрузить", { variant: "error", detail: error.message })
  });

  const uploadVideo = useMutation({
    mutationFn: (file: File) => api.uploadPostVideo(file),
    onSuccess: (uploaded) => {
      setVideo(uploaded.url);
      setPictures([]);
    },
    onError: (error: Error) =>
      notify("Не удалось загрузить видео", { variant: "error", detail: error.message })
  });

  const publish = useMutation({
    mutationFn: () => {
      const trimmed = link?.url.trim()
        ? { url: link.url.trim(), title: link.title.trim() }
        : null;
      const answers = poll?.map((option) => option.trim()).filter(Boolean) ?? null;
      return onPublish
        ? onPublish(content.trim(), pictures, trimmed, video, answers, sensitive)
        : api.createPost(content.trim(), pictures, trimmed, video, answers, sensitive);
    },
    onSuccess: async () => {
      setContent("");
      setPictures([]);
      setVideo(null);
      setPoll(null);
      setSensitive(false);
      setLink(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
      if (!onPublish) await queryClient.invalidateQueries({ queryKey: ["feed"] });
      notify("Запись опубликована", { variant: "success" });
      onPublished?.();
    },
    onError: (error: Error) =>
      notify("Не удалось опубликовать", { variant: "error", detail: error.message })
  });

  function grow(node: HTMLTextAreaElement) {
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }

  /**
   * Wrap the selection in a fenced block, or open an empty one.
   *
   * The fence is the same thing the card reads back, so what the author sees in the input is
   * what a reader gets: no hidden markup, and nothing to strip if they change their mind.
   */
  function wrapCode() {
    const node = inputRef.current;
    const start = node?.selectionStart ?? content.length;
    const end = node?.selectionEnd ?? content.length;
    const selected = content.slice(start, end);
    const opener = start === 0 || content[start - 1] === "\n" ? "" : "\n";
    const block = `${opener}\`\`\`\n${selected}\n\`\`\``;
    const next = `${content.slice(0, start)}${block}${content.slice(end)}`.slice(0, MAX_LENGTH);
    setContent(next);
    const caret = start + opener.length + 4;
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(caret, caret + selected.length);
      if (node) grow(node);
    });
  }

  function insertEmoji(emoji: string) {
    const node = inputRef.current;
    if (!node) {
      setContent((current) => current + emoji);
      return;
    }
    const start = node.selectionStart ?? content.length;
    const end = node.selectionEnd ?? content.length;
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`.slice(0, MAX_LENGTH);
    setContent(next);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + emoji.length, start + emoji.length);
      grow(node);
    });
  }

  const tooLong = content.length > MAX_LENGTH;
  // A picture or a clip is worth publishing on its own, so either counts as content.
  const canPublish =
    (content.trim().length >= 2 ||
      pictures.length > 0 ||
      Boolean(video) ||
      Boolean(link?.url.trim())) &&
    // An unfinished poll blocks publishing: half a question is worse than no question.
    (!poll || poll.filter((option) => option.trim()).length >= MIN_POLL_OPTIONS) &&
    !tooLong &&
    !publish.isPending &&
    !upload.isPending &&
    !uploadVideo.isPending;

  return (
    <div className="flex gap-3">
      <UserAvatar src={avatarUrl} name={displayName ?? "GRAM"} size={40} ringColor="transparent" />
      <div className="min-w-0 flex-1">
        <textarea
          ref={inputRef}
          rows={1}
          value={content}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(event) => {
            setContent(event.target.value);
            grow(event.currentTarget);
          }}
          className="block max-h-[45vh] min-h-9 w-full resize-none overflow-y-auto border-0 bg-transparent py-1.5 text-[17px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--dim)]"
        />

        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) upload.mutate(files);
          }}
        />

        <input
          ref={camera}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) upload.mutate(files);
          }}
        />

        <input
          ref={videoPicker}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadVideo.mutate(file);
          }}
        />

        {video ? (
          <div className="relative mb-1 overflow-hidden rounded-[14px] bg-black">
            <video src={video} className="block max-h-64 w-full object-contain" controls />
            <button
              type="button"
              aria-label="Убрать видео"
              onClick={() => setVideo(null)}
              className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black"
            >
              <X size={14} />
            </button>
          </div>
        ) : uploadVideo.isPending ? (
          <div className="skeleton mb-1 h-40 rounded-[14px]" />
        ) : null}

        {pictures.length ? (
          <div className="mb-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pictures.map((url) => (
              <span key={url} className="relative size-20 flex-none overflow-hidden rounded-[12px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media */}
                <img src={url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  aria-label="Убрать изображение"
                  onClick={() => setPictures((current) => current.filter((item) => item !== url))}
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
            {upload.isPending ? <span className="skeleton size-20 flex-none rounded-[12px]" /> : null}
          </div>
        ) : upload.isPending ? (
          <div className="mb-1 flex gap-2">
            <span className="skeleton size-20 rounded-[12px]" />
          </div>
        ) : null}

        {poll ? (
          <div className="mb-1 grid gap-1.5 rounded-[14px] bg-[var(--surface-raised)] p-2.5">
            {poll.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={option}
                  autoFocus={index === 0}
                  maxLength={60}
                  placeholder={`Вариант ${index + 1}`}
                  aria-label={`Вариант опроса ${index + 1}`}
                  onChange={(event) =>
                    setPoll((current) =>
                      (current ?? []).map((item, position) =>
                        position === index ? event.target.value : item
                      )
                    )
                  }
                  className="field min-w-0 flex-1 px-3 text-[15px]"
                />
                {poll.length > MIN_POLL_OPTIONS ? (
                  <button
                    type="button"
                    aria-label={`Убрать вариант ${index + 1}`}
                    onClick={() =>
                      setPoll((current) =>
                        (current ?? []).filter((_item, position) => position !== index)
                      )
                    }
                    className="icon-button !size-8"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={poll.length >= MAX_POLL_OPTIONS}
                onClick={() => setPoll((current) => [...(current ?? []), ""])}
                className="quiet-button !h-8 !px-3 !text-[13px]"
              >
                <Plus size={13} />
                Добавить вариант
              </button>
              <span className="text-[12px] text-[var(--dim)]">
                Вопрос — это текст записи. Голос нельзя изменить.
              </span>
            </div>
          </div>
        ) : null}

        {link ? (
          <div className="mb-1 grid gap-1.5 rounded-[14px] bg-[var(--surface-raised)] p-2.5">
            <input
              autoFocus
              value={link.url}
              onChange={(event) => setLink({ ...link, url: event.target.value })}
              inputMode="url"
              placeholder="https://…"
              aria-label="Ссылка для карточки"
              className="min-w-0 border-0 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--dim)]"
            />
            <input
              value={link.title}
              onChange={(event) => setLink({ ...link, title: event.target.value })}
              maxLength={120}
              placeholder="Подпись (необязательно)"
              aria-label="Подпись ссылки"
              className="min-w-0 border-0 bg-transparent text-[13px] text-[var(--muted)] outline-none placeholder:text-[var(--dim)]"
            />
            <p className="m-0 text-[12px] leading-4 text-[var(--dim)]">
              Читатель увидит карточку и подтвердит переход — GRAM предупредит, что сайт чужой.
            </p>
          </div>
        ) : null}

        {trackField ? (
          <div className="mb-1 grid gap-1 rounded-[14px] bg-[var(--surface-raised)] p-2.5">
            <input
              autoFocus
              inputMode="url"
              placeholder="https://soundcloud.com/…"
              aria-label="Ссылка на трек"
              onChange={(event) => {
                const link = event.target.value.trim();
                if (!MUSIC_LINK.test(link)) return;
                // The link joins the text, which is where the server looks for it.
                setContent((current) =>
                  `${current}${current.trim() && !current.endsWith("\n") ? "\n" : ""}${link}`.slice(
                    0,
                    MAX_LENGTH
                  )
                );
                setTrackField(false);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="field min-w-0 px-3 text-[15px]"
            />
            <span className="text-[12px] leading-4 text-[var(--dim)]">
              Ссылка попадёт в текст, а GRAM превратит её в карточку с обложкой и названием.
            </span>
          </div>
        ) : null}

        {sensitive ? (
          <div className="mb-1 flex items-center gap-2 rounded-[14px] bg-[var(--surface-raised)] px-3 py-2">
            <ShieldAlert size={15} className="flex-none text-[var(--stars)]" />
            <span className="min-w-0 flex-1 text-[13px] leading-4 text-[var(--muted)]">
              Вложения придут закрытыми: читатель сам решит, смотреть ли.
            </span>
            <button
              type="button"
              className="icon-button !size-7"
              aria-label="Убрать отметку 18+"
              onClick={() => setSensitive(false)}
            >
              <X size={13} />
            </button>
          </div>
        ) : null}

        <div className="mt-1 border-t border-[var(--line)] pt-2.5">
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ComposerAction
                icon={ImagePlus}
                label={
                  video
                    ? "Сначала уберите видео"
                    : pictures.length >= MAX_IMAGES
                      ? "Больше четырёх нельзя"
                      : "Добавить фото"
                }
                active={pictures.length > 0}
                onClick={() => picker.current?.click()}
                soon={Boolean(video) || pictures.length >= MAX_IMAGES}
              />
              <ComposerAction
                icon={Film}
                label={video ? "Убрать видео" : "Добавить видео"}
                active={Boolean(video)}
                onClick={() => (video ? setVideo(null) : videoPicker.current?.click())}
              />
              <ComposerAction
                icon={Music2}
                label={trackField ? "Убрать поле трека" : "Добавить трек"}
                active={trackField || MUSIC_LINK.test(content)}
                onClick={() => setTrackField((current) => !current)}
              />
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Эмодзи"
                    title="Эмодзи"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[var(--dim)] transition hover:bg-white/[0.06] hover:text-[var(--ink)] active:scale-95 sm:size-9"
                  >
                    <Smile size={20} />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-[95] grid w-[min(17rem,calc(100vw-24px))] grid-cols-8 gap-0.5 rounded-[18px] bg-[#121216] p-2 shadow-[0_18px_48px_rgba(0,0,0,.6),inset_0_0_0_1px_var(--line)]"
                  >
                    {EMOJI.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => insertEmoji(emoji)}
                        aria-label={`Вставить ${emoji}`}
                        className="grid size-8 place-items-center rounded-[10px] border-0 bg-transparent text-lg transition hover:bg-white/[0.08]"
                      >
                        {emoji}
                      </button>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <ComposerAction
                icon={Link2}
                label={link ? "Убрать ссылку" : "Прикрепить ссылку"}
                active={Boolean(link)}
                onClick={() => setLink(link ? null : { url: "", title: "" })}
              />
              <ComposerAction
                icon={BarChart3}
                label={poll ? "Убрать опрос" : "Опрос"}
                active={Boolean(poll)}
                onClick={() => setPoll(poll ? null : ["", ""])}
              />
              <ComposerMore
                onCamera={() => camera.current?.click()}
                onCode={wrapCode}
                sensitive={sensitive}
                onSensitive={() => setSensitive((current) => !current)}
              />
            </div>

            {content.length > MAX_LENGTH - 80 ? (
              <span className={`flex-none text-[13px] tabular-nums ${tooLong ? "text-[var(--danger)]" : "text-[var(--dim)]"}`}>
                {MAX_LENGTH - content.length}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => publish.mutate()}
              disabled={!canPublish}
              className="h-9 flex-none rounded-full border-0 bg-[#e7e9ea] px-4 text-[15px] font-bold text-black transition hover:bg-white active:scale-[0.98] disabled:opacity-40"
            >
              {publish.isPending ? "Публикуем…" : "Опубликовать"}
            </button>
          </div>
        </div>

        {publish.error ? (
          <p className="mb-0 mt-2 text-[13px] text-[var(--danger)]" aria-live="polite">
            {publish.error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ComposerAction({
  icon: Icon,
  label,
  soon,
  active,
  onClick
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  soon?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={soon}
      aria-label={soon ? `${label} — скоро` : label}
      aria-pressed={active}
      title={soon ? "Появится в следующем обновлении" : label}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent transition hover:bg-white/[0.06] hover:text-[var(--ink)] active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent sm:size-9 ${active ? "text-[var(--primary-strong)]" : "text-[var(--dim)]"}`}
    >
      <Icon size={20} />
    </button>
  );
}

function ComposerMore({
  onCamera,
  onCode,
  sensitive,
  onSensitive
}: {
  onCamera: () => void;
  onCode: () => void;
  sensitive: boolean;
  onSensitive: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Ещё"
          title="Ещё"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[var(--dim)] transition hover:bg-white/[0.06] hover:text-[var(--ink)] active:scale-95 sm:size-9"
        >
          <MoreHorizontal size={20} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[95] min-w-[232px] rounded-[18px] bg-[#202026] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
        >
          <DropdownMenu.Item
            onSelect={onCamera}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <Camera size={18} />
            <span className="flex-1">Камера</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onCode}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <Code2 size={18} />
            <span className="flex-1">Блок кода</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onSensitive}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <ShieldAlert size={18} className={sensitive ? "text-[var(--stars)]" : undefined} />
            <span className="flex-1">{sensitive ? "Снять отметку 18+" : "Контент 18+"}</span>
            {sensitive ? <Check size={15} /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
          {MORE_SOON.map(({ icon: Icon, label }) => (
            <DropdownMenu.Item
              key={label}
              disabled
              className="flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold text-[var(--dim)] outline-none data-[disabled]:opacity-60"
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              <span className="text-[12px] font-bold text-[var(--faint)]">скоро</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
