"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, ImagePlus, Loader2, Pin, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "../ui/toast";
import { StoryMedia } from "./story-media";

/** A story's window, the length the whole reference uses. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** The server's own limit on a caption; the field says so rather than failing on submit. */
const CAPTION_MAX = 120;

/**
 * Publishing a story: pick a picture or a clip, write a line over it if there is one to write,
 * and decide whether it stays on the profile after its day is up.
 *
 * The file is uploaded the moment it is chosen, so what the author previews is the same bytes
 * the story will carry — and a rejected file is refused here rather than at publish.
 */
export function StoryComposer({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<{ url: string; preview: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [keep, setKeep] = useState(false);

  function reset() {
    if (media) URL.revokeObjectURL(media.preview);
    setMedia(null);
    setCaption("");
    setKeep(false);
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const stored = await api.uploadStoryMedia(file);
      return { url: stored.url, preview: URL.createObjectURL(file) };
    },
    onSuccess: (next) => {
      if (media) URL.revokeObjectURL(media.preview);
      setMedia(next);
    },
    onError: (error: Error) =>
      notify("File not supported", { variant: "error", detail: error.message })
  });

  const publish = useMutation({
    mutationFn: () =>
      api.createProfileStory({
        media_url: media!.url,
        title: caption.trim(),
        // A day either way; the difference is whether the profile keeps it afterwards.
        highlight: keep,
        expires_at: new Date(Date.now() + DAY_MS).toISOString()
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["stories-feed"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-stories"] })
      ]);
      notify("Story published", {
        variant: "success",
        detail: keep ? "A day in the feed, then on your profile" : "Disappears after 24 hours"
      });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't publish story", { variant: "error", detail: error.message })
  });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[115] bg-black/72 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[116] w-[min(24rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-[var(--surface)] p-4 shadow-[0_24px_70px_rgba(0,0,0,.66),inset_0_0_0_1px_var(--line)] outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="m-0 text-[18px] font-extrabold leading-tight">
              New story
            </Dialog.Title>
            <Dialog.Close
              className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--surface-raised)] transition hover:brightness-125"
              aria-label="Close"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-0 mt-1 text-[13px] leading-5 text-[var(--muted)]">
            A photo or video for a day. A caption is optional.
          </Dialog.Description>

          <input
            ref={picker}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />

          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={upload.isPending}
            className="relative mt-3 block aspect-[9/16] max-h-[46vh] w-full overflow-hidden rounded-[18px] border-0 bg-[var(--surface-raised)] p-0 transition hover:brightness-110 disabled:opacity-70"
            aria-label={media ? "Replace file" : "Choose a photo or video"}
          >
            {media ? (
              <StoryMedia url={media.preview} alt="Story preview" muted />
            ) : (
              <span className="grid h-full w-full place-items-center gap-1.5 px-6 text-center">
                <span>
                  {upload.isPending ? (
                    <Loader2 size={26} className="mx-auto animate-spin text-[var(--muted)]" />
                  ) : (
                    <ImagePlus size={26} className="mx-auto text-[var(--muted)]" />
                  )}
                  <span className="mt-2 block text-[15px] font-bold">
                    {upload.isPending ? "Uploading…" : "Choose a photo or video"}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                    Vertical looks best
                  </span>
                </span>
              </span>
            )}
            {media && upload.isPending ? (
              <span className="absolute inset-0 grid place-items-center bg-black/45">
                <Loader2 size={24} className="animate-spin text-white" />
              </span>
            ) : null}
          </button>

          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={CAPTION_MAX}
            placeholder="Caption"
            aria-label="Story caption"
            className="mt-3 min-h-11 w-full rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 text-[14px] outline-none placeholder:text-[var(--dim)]"
          />

          <button
            type="button"
            onClick={() => setKeep((current) => !current)}
            aria-pressed={keep}
            className="mt-2 flex w-full items-center gap-2.5 rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 py-2.5 text-left transition hover:brightness-110"
          >
            {keep ? (
              <Pin size={17} className="flex-none text-[var(--primary-strong)]" />
            ) : (
              <Clock size={17} className="flex-none text-[var(--muted)]" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">
                {keep ? "Keep on profile" : "24 hours only"}
              </span>
              <span className="block text-[12px] text-[var(--dim)]">
                {keep
                  ? "After a day the story stays on your page"
                  : "The story disappears after a day"}
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={!media || upload.isPending || publish.isPending}
            onClick={() => publish.mutate()}
            className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-full border-0 bg-[var(--primary)] px-4 font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
