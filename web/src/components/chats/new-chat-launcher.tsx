"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Camera, Check, MessageSquarePlus, Pencil, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useToast } from "../ui/toast";
import { PeoplePicker } from "./people-picker";

const PICK_ACCENT = "#0ea5e9";
type Step = "closed" | "menu" | "message" | "secret" | "group-members" | "group-name";

/**
 * "New chat": the reference's round accent button, its three-item popover, and the
 * full-screen flows behind each item. Markup and geometry are lifted from the reference —
 * 52px button at 26px radius, and a 224px popover sitting one row above it.
 */
export function NewChatLauncher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<Step>("closed");
  const [members, setMembers] = useState<User[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  // Who can enter and whether it is encrypted. Private by default: it's easier to hand out a link
  // later than to revoke one, and a secret group is a deliberate choice.
  const [groupAccess, setGroupAccess] = useState<"private" | "public" | "secret">("private");

  useEffect(() => {
    if (step !== "menu") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStep("closed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const openChat = useMutation({
    mutationFn: ({ user, secret }: { user: User; secret: boolean }) =>
      secret ? api.secretChat(user.username) : api.directChat(user.username),
    onSuccess: async (chat) => {
      setStep("closed");
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chats?chat=${chat.id}`);
    },
    onError: (error: Error) =>
      notify("Couldn't open chat", { variant: "error", detail: error.message })
  });

  const createGroup = useMutation({
    mutationFn: () =>
      api.createGroupChat(
        groupTitle.trim(),
        members.map((user) => user.username),
        groupAccess === "public",
        groupAccess === "secret"
      ),
    onSuccess: async (chat) => {
      setStep("closed");
      setMembers([]);
      setGroupTitle("");
      setGroupAccess("private");
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      notify(
        chat.is_secret
          ? "Secret group created"
          : chat.is_public
            ? "Public group created"
            : "Group created",
        {
          variant: "success",
          detail: chat.is_secret
            ? "End-to-end encrypted — keys are shared with members"
            : chat.is_public
              ? "The link is in “About group”"
              : undefined
        }
      );
      router.push(`/chats?chat=${chat.id}`);
    },
    onError: (error: Error) =>
      notify("Couldn't create group", { variant: "error", detail: error.message })
  });

  const items = [
    { key: "group", label: "New group", icon: Users, run: () => setStep("group-members") },
    { key: "message", label: "New message", icon: MessageSquarePlus, run: () => setStep("message") },
    { key: "secret", label: "Secret chat", icon: LockIcon, run: () => setStep("secret") }
  ] as const;

  return (
    <>
      <button
        type="button"
        aria-label="New chat"
        aria-expanded={step === "menu"}
        onClick={() => setStep((current) => (current === "menu" ? "closed" : "menu"))}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-5 z-40 inline-flex size-[52px] items-center justify-center rounded-[26px] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition active:scale-95 md:bottom-8"
        style={{ background: "var(--chat-accent, var(--primary))" }}
      >
        <Pencil size={22} />
      </button>

      <AnimatePresence>
        {step === "menu" ? (
          <>
            {/* A backdrop, so tapping anywhere dismisses without also hitting what is under it. */}
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setStep("closed")}
              className="fixed inset-0 z-[39] cursor-default border-0 bg-transparent"
            />
            <motion.div
              role="menu"
              aria-label="New chat"
              initial={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.97 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-5 z-40 w-56 origin-bottom-right overflow-hidden rounded-2xl border border-[var(--sheet-line)] bg-[var(--surface-raised)] py-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)] md:bottom-[7.5rem]"
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={item.run}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-[16px] transition hover:bg-white/[0.06] active:bg-white/[0.09]"
                >
                  <item.icon size={20} className="flex-none text-[var(--muted)]" />
                  {item.label}
                </button>
              ))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <PeoplePicker
        open={step === "message"}
        onClose={() => setStep("closed")}
        title="New message"
        mode="single"
        placeholder="Who to message"
        pending={openChat.isPending}
        onPick={(user) => openChat.mutate({ user, secret: false })}
      />
      <PeoplePicker
        open={step === "secret"}
        onClose={() => setStep("closed")}
        title="Secret chat"
        mode="single"
        tone="secret"
        placeholder="Who to start with"
        note="Messages are flagged as secret and aren't shown in the general device list."
        pending={openChat.isPending}
        onPick={(user) => openChat.mutate({ user, secret: true })}
      />
      <PeoplePicker
        open={step === "group-members"}
        onClose={() => setStep("closed")}
        title="New group"
        mode="multi"
        placeholder="Who to add"
        actionLabel="Next"
        onSubmit={(chosen) => {
          setMembers(chosen);
          setStep("group-name");
        }}
      />

      <AnimatePresence>
        {step === "group-name" ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Group name"
            initial={reduceMotion ? undefined : { opacity: 0, x: 24 }}
            animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: 24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[60] flex flex-col bg-[var(--sheet)] text-[var(--ink)]"
          >
            <div className="flex flex-none items-center gap-2 border-b border-[var(--sheet-line)] px-2 py-3">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setStep("group-members")}
                className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="m-0 flex-1 text-[18px] font-medium">Group name</h2>
              <button
                type="button"
                disabled={!groupTitle.trim() || createGroup.isPending}
                onClick={() => createGroup.mutate()}
                className="h-9 rounded-full px-4 text-[15px] font-medium text-white transition disabled:opacity-50"
                style={{ background: PICK_ACCENT }}
              >
                {createGroup.isPending ? "Creating…" : "Create"}
              </button>
            </div>
            <div className="flex-1 px-4 py-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Group photo — coming soon"
                  title="Photo upload is coming in the next update"
                  onClick={() =>
                    notify("Group photo", {
                      variant: "info",
                      detail: "Coming in the next update"
                    })
                  }
                  className="relative inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2b3947] text-white"
                >
                  <Camera size={28} />
                </button>
                <input
                  autoFocus
                  value={groupTitle}
                  onChange={(event) => setGroupTitle(event.target.value)}
                  maxLength={100}
                  placeholder="Group name"
                  aria-label="Group name"
                  className="flex-1 border-0 border-b border-[var(--sheet-line)] bg-transparent pb-2 text-[17px] outline-none placeholder:text-[var(--muted)]"
                />
              </div>
              <p className="mt-6 text-[13px] text-[var(--muted)]">{members.length} members</p>
              {/* Who can enter and whether it is encrypted. A public group gets a link right away;
                  a private one is invite-only; a secret one is end-to-end encrypted and cannot be
                  public (its membership is fixed so keys can be shared). */}
              <div className="mt-5 grid gap-2">
                {(
                  [
                    {
                      value: "private",
                      label: "Private group",
                      hint: "Only the owner adds members"
                    },
                    {
                      value: "public",
                      label: "Public group",
                      hint: "Join via link — you can forward it to anyone"
                    },
                    {
                      value: "secret",
                      label: "Secret group",
                      hint: "End-to-end encrypted — no link, invite-only"
                    }
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={groupAccess === option.value}
                    onClick={() => setGroupAccess(option.value)}
                    className="flex items-center gap-3 rounded-[14px] border-0 bg-white/[0.06] px-3 py-2.5 text-left transition hover:bg-white/[0.1]"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-5 flex-none items-center justify-center rounded-full border"
                      style={
                        groupAccess === option.value
                          ? { borderColor: PICK_ACCENT, background: PICK_ACCENT, color: "#fff" }
                          : { borderColor: "rgba(255,255,255,.28)" }
                      }
                    >
                      {groupAccess === option.value ? <Check size={13} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">{option.label}</span>
                      <span className="block text-[12px] text-[var(--muted)]">{option.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              {createGroup.error ? (
                <p className="mt-2 text-[13px] text-[var(--danger)]">{createGroup.error.message}</p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function LockIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z"
        fill="currentColor"
      />
    </svg>
  );
}
