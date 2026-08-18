"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PenLine, X } from "lucide-react";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { PostComposer } from "./feed/post-composer";

/**
 * «Новая запись» — the same composer the feed shows, in a sheet.
 *
 * It used to be a second, poorer composer: an image field that only took a URL, disabled emoji
 * and media buttons, and a desktop card that kept its `translateX(-50%)` on phones, which put
 * it half off screen. One composer means one set of features to keep working.
 */
export function ComposeDialog() {
  const { composerOpen, closeComposer } = useUiStore();
  const reduceMotion = useReducedMotion();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: composerOpen });

  return (
    <Dialog.Root open={composerOpen} onOpenChange={(open) => !open && closeComposer()}>
      <AnimatePresence>
        {composerOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              {/*
               * Phones get a sheet pinned to the bottom edge; from `sm` up it becomes the
               * reference's 620px card. The two layouts are separate rather than one card with
               * a transform, which is what put the old dialog off centre on mobile.
               */}
              <motion.div
                className="fixed inset-x-0 bottom-0 z-[101] max-h-[92dvh] overflow-y-auto rounded-t-[28px] bg-[#17171d] p-4 shadow-[0_-12px_60px_rgba(0,0,0,.6)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[620px] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:p-5"
                initial={reduceMotion ? undefined : { opacity: 0, y: 40 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 30 }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PenLine size={18} className="text-[var(--primary-strong)]" />
                    <Dialog.Title className="font-bold">Новая запись</Dialog.Title>
                  </div>
                  <Dialog.Close className="icon-button" aria-label="Закрыть">
                    <X size={20} />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Текст, фотографии и ссылка на музыку — всё в одной записи.
                </Dialog.Description>
                <PostComposer
                  avatarUrl={me?.avatar_url}
                  displayName={me?.display_name}
                  onPublished={closeComposer}
                />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
