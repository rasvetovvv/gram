"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarClock,
  Camera,
  Check,
  Clock,
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
import { DraftsSheet } from "./drafts-sheet";
import { ScheduledSheet } from "./scheduled-sheet";
import { UserAvatar } from "../user-avatar";

/*
 * What a post may hold, and what Premium raises it to. Both pairs are the server's own numbers
 * (`FREE_POST_LENGTH` / `PREMIUM_POST_LENGTH` and the image pair beside them): the composer must
 * not offer what the API would refuse, and must not withhold what a subscriber has paid for.
 */
const MAX_LENGTH = 1000;
const MAX_LENGTH_PREMIUM = 4000;
const MAX_IMAGES = 4;
const MAX_IMAGES_PREMIUM = 10;
/** What the server recognises as a track, so the field can tell a link from a paste of text. */
const MUSIC_LINK = /https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/\S+/i;
/** The server's own bounds for a poll, so the composer cannot offer what it would refuse. */
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;

/*
 * The earliest moment the picker offers, worked out once when the module loads rather than on
 * every render — a clock read during render is exactly what React's purity rule forbids. It is a
 * hint on the input and nothing more: the server decides what a moment means, and treats one in
 * the past as "publish now".
 */
const EARLIEST_SCHEDULE = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

const EMOJI = ["🙂", "😂", "🔥", "❤️", "👍", "🎉", "✨", "😮", "😢", "🙏", "👀", "💯", "🌙", "☕", "📷", "🎧"];

/** The reference's "More" menu. Only the surfaces GRAM actually supports are enabled. */


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
  placeholder = "What's new?",
  communitySlug,
  onPublished,
  onPublish
}: {
  avatarUrl?: string | null;
  displayName?: string;
  placeholder?: string;
  /** Set on a channel's page, so a draft saved there is offered back there. */
  communitySlug?: string;
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
    sensitive: boolean,
    file: { url: string; name: string; size: number } | null,
    options?: { publishAt?: string | null }
  ) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const premium = Boolean(me.data?.is_premium);
  // The ceilings this author actually has. Premium is the only thing that moves them.
  const maxLength = premium ? MAX_LENGTH_PREMIUM : MAX_LENGTH;
  const maxImages = premium ? MAX_IMAGES_PREMIUM : MAX_IMAGES;
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
  // One document, uploaded before publishing like everything else the post carries.
  const [file, setFile] = useState<{ url: string; name: string; size: number } | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  /*
   * The draft this composer is holding, if it was picked up from the drawer. Saving again writes
   * over it rather than leaving two copies of the same unfinished post, and publishing removes
   * it — a published draft is a post.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  /*
   * When this post should go out, as a `datetime-local` value. Empty means now, which is what
   * every post was before Premium got a queue; the field only appears once somebody asks for it.
   */
  const [scheduleFor, setScheduleFor] = useState("");
  const [scheduleField, setScheduleField] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const upload = useMutation({
    mutationFn: (files: File[]) =>
      Promise.all(files.slice(0, maxImages - pictures.length).map((file) => api.uploadPostMedia(file))),
    onSuccess: (uploaded) =>
      setPictures((current) => [...current, ...uploaded.map((item) => item.url)].slice(0, maxImages)),
    onError: (error: Error) =>
      notify("Couldn't upload", { variant: "error", detail: error.message })
  });

  const uploadVideo = useMutation({
    mutationFn: (file: File) => api.uploadPostVideo(file),
    onSuccess: (uploaded) => {
      setVideo(uploaded.url);
      setPictures([]);
    },
    onError: (error: Error) =>
      notify("Couldn't upload the video", { variant: "error", detail: error.message })
  });

  const uploadFile = useMutation({
    mutationFn: (chosen: File) => api.uploadPostFile(chosen),
    onSuccess: (uploaded) =>
      setFile({ url: uploaded.url, name: uploaded.name, size: uploaded.size }),
    onError: (error: Error) =>
      notify("Couldn't attach the file", { variant: "error", detail: error.message })
  });

  const draftBody = () => ({
    content,
    image_urls: pictures.length ? pictures : undefined,
    video_url: video,
    file_url: file?.url,
    file_name: file?.name,
    file_size: file?.size,
    poll_options: poll?.length ? poll : undefined,
    sensitive,
    link_url: link?.url.trim() || undefined,
    link_title: link?.title.trim() || undefined,
    community_slug: communitySlug ?? undefined
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      draftId ? api.updatePostDraft(draftId, draftBody()) : api.savePostDraft(draftBody()),
    onSuccess: async (saved) => {
      setDraftId(saved.id);
      await queryClient.invalidateQueries({ queryKey: ["post-drafts"] });
      notify("Draft saved", { variant: "success", detail: "Find it under “More”." });
    },
    onError: (error: Error) =>
      notify("Couldn't save", { variant: "error", detail: error.message })
  });

  const publish = useMutation({
    mutationFn: () => {
      const trimmed = link?.url.trim()
        ? { url: link.url.trim(), title: link.title.trim() }
        : null;
      const answers = poll?.map((option) => option.trim()).filter(Boolean) ?? null;
      // `datetime-local` has no zone, so the browser's own reading of it is the right one.
      const publishAt = scheduleFor ? new Date(scheduleFor).toISOString() : null;
      const options = { publishAt };
      return onPublish
        ? onPublish(content.trim(), pictures, trimmed, video, answers, sensitive, file, options)
        : api.createPost(
            content.trim(),
            pictures,
            trimmed,
            video,
            answers,
            sensitive,
            file,
            options
          );
    },
    onSuccess: async () => {
      setContent("");
      setPictures([]);
      setVideo(null);
      setPoll(null);
      setFile(null);
      setSensitive(false);
      setLink(null);
      const wasQueued = Boolean(scheduleFor);
      setScheduleFor("");
      setScheduleField(false);
      // A published draft is a post, so it stops being a draft.
      if (draftId) {
        void api.deletePostDraft(draftId).catch(() => undefined);
        setDraftId(null);
        void queryClient.invalidateQueries({ queryKey: ["post-drafts"] });
      }
      if (inputRef.current) inputRef.current.style.height = "auto";
      if (!onPublish) await queryClient.invalidateQueries({ queryKey: ["feed"] });
      if (wasQueued) await queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
      notify(wasQueued ? "Post scheduled" : "Post published", {
        variant: "success",
        detail: wasQueued ? "Find it under “More” → “Scheduled”" : undefined
      });
      onPublished?.();
    },
    onError: (error: Error) =>
      notify("Couldn't publish", { variant: "error", detail: error.message })
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
    const next = `${content.slice(0, start)}${block}${content.slice(end)}`.slice(0, maxLength);
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
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`.slice(0, maxLength);
    setContent(next);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + emoji.length, start + emoji.length);
      grow(node);
    });
  }

  const tooLong = content.length > maxLength;
  // Worth saving if anything at all has been put in: a draft may be as unfinished as it likes.
  const hasSomething = Boolean(
    content.trim() ||
      pictures.length ||
      video ||
      file ||
      poll?.some((option) => option.trim()) ||
      link?.url.trim()
  );
  // A picture or a clip is worth publishing on its own, so either counts as content.
  const canPublish =
    (content.trim().length >= 2 ||
      pictures.length > 0 ||
      Boolean(video) ||
      Boolean(file) ||
      Boolean(link?.url.trim())) &&
    !uploadFile.isPending &&
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
          ref={filePicker}
          type="file"
          accept=".pdf,.zip,.txt,.md,.csv,.json,.log"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) uploadFile.mutate(chosen);
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
              aria-label="Remove video"
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
                  aria-label="Remove image"
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
                  placeholder={`Option ${index + 1}`}
                  aria-label={`Poll option ${index + 1}`}
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
                    aria-label={`Remove option ${index + 1}`}
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
                Add option
              </button>
              <span className="text-[12px] text-[var(--dim)]">
The question is the post text. A vote can&apos;t be changed.
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
              aria-label="Link for the card"
              className="min-w-0 border-0 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--dim)]"
            />
            <input
              value={link.title}
              onChange={(event) => setLink({ ...link, title: event.target.value })}
              maxLength={120}
              placeholder="Caption (optional)"
              aria-label="Link caption"
              className="min-w-0 border-0 bg-transparent text-[13px] text-[var(--muted)] outline-none placeholder:text-[var(--dim)]"
            />
            <p className="m-0 text-[12px] leading-4 text-[var(--dim)]">
The reader sees a card and confirms before following it — GRAM warns that the site is external.
            </p>
          </div>
        ) : null}

        {file ? (
          <div className="mb-1 flex items-center gap-2 rounded-[14px] bg-[var(--surface-raised)] p-2 pr-2.5">
            <span className="grid size-9 flex-none place-items-center rounded-[11px] bg-black/25 text-[var(--primary-strong)]">
              <Paperclip size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{file.name}</span>
              <span className="block text-[12px] text-[var(--dim)]">
                {file.size < 1024 * 1024
                  ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                  : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
              </span>
            </span>
            <button
              type="button"
              className="icon-button !size-8"
              aria-label="Remove file"
              onClick={() => setFile(null)}
            >
              <X size={14} />
            </button>
          </div>
        ) : uploadFile.isPending ? (
          <div className="skeleton mb-1 h-14 rounded-[14px]" />
        ) : null}

        {trackField ? (
          <div className="mb-1 grid gap-1 rounded-[14px] bg-[var(--surface-raised)] p-2.5">
            <input
              autoFocus
              inputMode="url"
              placeholder="https://soundcloud.com/…"
              aria-label="Track link"
              onChange={(event) => {
                const link = event.target.value.trim();
                if (!MUSIC_LINK.test(link)) return;
                // The link joins the text, which is where the server looks for it.
                setContent((current) =>
                  `${current}${current.trim() && !current.endsWith("\n") ? "\n" : ""}${link}`.slice(
                    0,
                    maxLength
                  )
                );
                setTrackField(false);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="field min-w-0 px-3 text-[15px]"
            />
            <span className="text-[12px] leading-4 text-[var(--dim)]">
The link goes into the text, and GRAM turns it into a card with cover art and a title.
            </span>
          </div>
        ) : null}

        {/* When this post goes out. Empty is “now”, which is what every post was before. */}
        {scheduleField ? (
          <div className="mb-1 grid gap-1 rounded-[14px] bg-[var(--surface-raised)] p-2.5">
            <label
              className="text-[12px] font-semibold text-[var(--muted)]"
              htmlFor="composer-schedule"
            >
When to publish
            </label>
            <div className="flex items-center gap-2">
              <input
                id="composer-schedule"
                autoFocus
                type="datetime-local"
                value={scheduleFor}
                min={EARLIEST_SCHEDULE}
                onChange={(event) => setScheduleFor(event.target.value)}
                className="field min-w-0 flex-1 px-3 text-[15px]"
              />
              {scheduleFor ? (
                <button
                  type="button"
                  aria-label="Publish now"
                  onClick={() => {
                    setScheduleFor("");
                    setScheduleField(false);
                  }}
                  className="icon-button !size-9 text-[var(--muted)]"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <span className="text-[12px] leading-4 text-[var(--dim)]">
Until then only you can see the post — under “More” → “Scheduled”.
            </span>
          </div>
        ) : null}

        {sensitive ? (
          <div className="mb-1 flex items-center gap-2 rounded-[14px] bg-[var(--surface-raised)] px-3 py-2">
            <ShieldAlert size={15} className="flex-none text-[var(--stars)]" />
            <span className="min-w-0 flex-1 text-[13px] leading-4 text-[var(--muted)]">
Attachments arrive hidden: the reader decides whether to view them.
            </span>
            <button
              type="button"
              className="icon-button !size-7"
              aria-label="Remove 18+ mark"
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
                    ? "Remove the video first"
                    : pictures.length >= maxImages
                      ? "Four is the maximum"
                      : "Add photo"
                }
                active={pictures.length > 0}
                onClick={() => picker.current?.click()}
                soon={Boolean(video) || pictures.length >= maxImages}
              />
              <ComposerAction
                icon={Film}
                label={video ? "Remove video" : "Add video"}
                active={Boolean(video)}
                onClick={() => (video ? setVideo(null) : videoPicker.current?.click())}
              />
              <ComposerAction
                icon={Music2}
                label={trackField ? "Remove track field" : "Add track"}
                active={trackField || MUSIC_LINK.test(content)}
                onClick={() => setTrackField((current) => !current)}
              />
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Emoji"
                    title="Emoji"
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
                        aria-label={`Insert ${emoji}`}
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
                label={link ? "Remove link" : "Attach link"}
                active={Boolean(link)}
                onClick={() => setLink(link ? null : { url: "", title: "" })}
              />
              <ComposerAction
                icon={BarChart3}
                label={poll ? "Remove poll" : "Poll"}
                active={Boolean(poll)}
                onClick={() => setPoll(poll ? null : ["", ""])}
              />
              <ComposerMore
                onCamera={() => camera.current?.click()}
                onCode={wrapCode}
                onFile={() => (file ? setFile(null) : filePicker.current?.click())}
                fileAttached={Boolean(file)}
                sensitive={sensitive}
                onSensitive={() => setSensitive((current) => !current)}
                onSaveDraft={() => saveDraft.mutate()}
                canSaveDraft={hasSomething && !saveDraft.isPending}
                onOpenDrafts={() => setDraftsOpen(true)}
                scheduled={Boolean(scheduleFor)}
                onSchedule={() => {
                  if (!premium) {
                    notify("Scheduled posting is a GRAM Premium feature", {
                      variant: "error",
                      detail: "A subscription unlocks the post queue and higher limits"
                    });
                    return;
                  }
                  if (scheduleFor) {
                    setScheduleFor("");
                    setScheduleField(false);
                    return;
                  }
                  setScheduleField(true);
                }}
                onOpenQueue={() => setQueueOpen(true)}
              />
            </div>

            {content.length > maxLength - 80 ? (
              <span className={`flex-none text-[13px] tabular-nums ${tooLong ? "text-[var(--danger)]" : "text-[var(--dim)]"}`}>
                {maxLength - content.length}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => publish.mutate()}
              disabled={!canPublish}
              className="h-9 flex-none rounded-full border-0 bg-[#e7e9ea] px-4 text-[15px] font-bold text-black transition hover:bg-white active:scale-[0.98] disabled:opacity-40"
            >
              {publish.isPending
                ? scheduleFor
                  ? "Scheduling…"
                  : "Publishing…"
                : scheduleFor
                  ? "Schedule"
                  : "Publish"}
            </button>
          </div>
        </div>

        <ScheduledSheet open={queueOpen} onOpenChange={setQueueOpen} />

        <DraftsSheet
          open={draftsOpen}
          onOpenChange={setDraftsOpen}
          onPick={(draft) => {
            setDraftId(draft.id);
            setContent(draft.content ?? "");
            setPictures(draft.image_urls ?? []);
            setVideo(draft.video_url ?? null);
            setFile(
              draft.file_url
                ? {
                    url: draft.file_url,
                    name: draft.file_name ?? "File",
                    size: draft.file_size ?? 0
                  }
                : null
            );
            setPoll(draft.poll_options?.length ? draft.poll_options : null);
            setSensitive(Boolean(draft.sensitive));
            setLink(
              draft.link_url ? { url: draft.link_url, title: draft.link_title ?? "" } : null
            );
            requestAnimationFrame(() => {
              const node = inputRef.current;
              node?.focus();
              if (node) grow(node);
            });
          }}
        />

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
      aria-label={soon ? `${label} — soon` : label}
      aria-pressed={active}
      title={soon ? "Coming in the next update" : label}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent transition hover:bg-white/[0.06] hover:text-[var(--ink)] active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent sm:size-9 ${active ? "text-[var(--primary-strong)]" : "text-[var(--dim)]"}`}
    >
      <Icon size={20} />
    </button>
  );
}

function ComposerMore({
  onCamera,
  onCode,
  onFile,
  fileAttached,
  sensitive,
  onSensitive,
  onSaveDraft,
  canSaveDraft,
  onOpenDrafts,
  scheduled,
  onSchedule,
  onOpenQueue
}: {
  onCamera: () => void;
  onCode: () => void;
  onFile: () => void;
  fileAttached: boolean;
  sensitive: boolean;
  onSensitive: () => void;
  onSaveDraft: () => void;
  canSaveDraft: boolean;
  onOpenDrafts: () => void;
  scheduled: boolean;
  onSchedule: () => void;
  onOpenQueue: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="More"
          title="More"
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
            <span className="flex-1">Camera</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onFile}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <Paperclip size={18} className={fileAttached ? "text-[var(--primary-strong)]" : undefined} />
            <span className="flex-1">{fileAttached ? "Remove file" : "Attach file"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onCode}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <Code2 size={18} />
            <span className="flex-1">Code block</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onSensitive}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <ShieldAlert size={18} className={sensitive ? "text-[var(--stars)]" : undefined} />
            <span className="flex-1">{sensitive ? "Remove 18+ mark" : "18+ content"}</span>
            {sensitive ? <Check size={15} /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
          <DropdownMenu.Item
            onSelect={onSaveDraft}
            disabled={!canSaveDraft}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06] data-[disabled]:cursor-default data-[disabled]:opacity-50"
          >
            <Save size={18} />
            <span className="flex-1">Save draft</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onOpenDrafts}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <FileText size={18} />
            <span className="flex-1">Drafts</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
          <DropdownMenu.Item
            onSelect={onSchedule}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <Clock size={18} className={scheduled ? "text-[var(--primary-strong)]" : undefined} />
            <span className="flex-1">{scheduled ? "Publish now" : "Schedule post"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onOpenQueue}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold outline-none focus:bg-white/[0.06]"
          >
            <CalendarClock size={18} />
            <span className="flex-1">Scheduled</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
