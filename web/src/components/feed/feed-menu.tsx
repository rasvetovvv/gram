"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Crown,
  LogOut,
  Menu,
  Palette,
  Plus,
  Sparkles,
  Star,
  Users,
  UsersRound
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { rememberAccount } from "@/lib/accounts";
import type { AccountSlot } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useUiStore } from "@/store/ui";
import { UserAvatar } from "../user-avatar";
import { useToast } from "../ui/toast";

/**
 * The feed's overflow menu, copied from the reference's own `.btn-menu`: a 216px translucent
 * panel of 32px rows at 14px/500, split by hairlines into accounts, places, and settings.
 *
 * It is where account switching lives now — the reference puts it here rather than burying it
 * in profile settings, and an account you cannot see is an account you forget you have.
 */
const PANEL =
  "z-[121] w-[216px] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl py-1 shadow-[0_0_10px_rgba(0,0,0,.55)]";
const PANEL_STYLE = {
  background: "rgba(28,28,30,.75)",
  backdropFilter: "blur(50px)"
} as const;
const ROW =
  "flex min-h-8 cursor-pointer items-center gap-3 py-1 pl-3 pr-[30px] text-[14px] font-medium outline-none focus:bg-white/[0.07] data-[highlighted]:bg-white/[0.07]";
const RULE = "my-1 h-px border-0 bg-white/[0.08]";

export function FeedMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const openPremium = useUiStore((state) => state.openPremium);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setUser = useAuthStore((state) => state.setUser);
  const [more, setMore] = useState(false);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const slots = useQuery({ queryKey: ["auth-accounts"], queryFn: api.authAccounts });
  const others = (slots.data ?? []).filter((slot) => !slot.active);

  const activate = useMutation({
    mutationFn: (slot: AccountSlot) => api.activateAccount(slot.user.id),
    onSuccess: async (session) => {
      setUser(session.user);
      rememberAccount(session.user);
      // Everything cached belonged to the account that was active a moment ago.
      queryClient.clear();
      await queryClient.invalidateQueries();
      notify(`You're now signed in as @${session.user.username}`, { variant: "success" });
      router.replace("/");
    },
    onError: (error: Error) =>
      notify("Couldn't switch accounts", { variant: "error", detail: error.message })
  });

  return (
    <DropdownMenu.Root onOpenChange={(open) => !open && setMore(false)}>
      <DropdownMenu.Trigger asChild>
        <button className="icon-button" aria-label="Menu" title="Accounts, saved and settings">
          <Menu size={20} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className={PANEL} style={PANEL_STYLE}>
          {me ? (
            <DropdownMenu.Item className={ROW} onSelect={() => router.push(`/u/${me.username}`)}>
              <UserAvatar src={me.avatar_url} name={me.display_name} size={24} ringColor="transparent" />
              <span className="min-w-0 flex-1 truncate">{me.username}</span>
              <Check size={14} className="flex-none opacity-70" />
            </DropdownMenu.Item>
          ) : null}

          {/* Other accounts on this device switch in place, without a password. */}
          {others.map((slot) => (
            <DropdownMenu.Item
              key={slot.user.id}
              className={ROW}
              disabled={activate.isPending}
              onSelect={() => activate.mutate(slot)}
            >
              <UserAvatar
                src={slot.user.avatar_url}
                name={slot.user.display_name}
                size={24}
                ringColor="transparent"
              />
              <span className="min-w-0 flex-1 truncate">{slot.user.username}</span>
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Item
            className={ROW}
            onSelect={() => {
              // The current account stays parked, so this adds one instead of replacing it.
              clearSession();
              queryClient.clear();
              router.push("/login");
            }}
          >
            <Plus size={20} className="flex-none" />
            Add account
          </DropdownMenu.Item>

          <DropdownMenu.Separator className={RULE} />

          <DropdownMenu.Item className={ROW} onSelect={() => router.push("/saved")}>
            <Bookmark size={20} className="flex-none" />
            Saved
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ROW} onSelect={() => router.push("/chats?filter=archived")}>
            <Archive size={20} className="flex-none" />
            Archive
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={ROW}
            onSelect={() => router.push(me ? `/u/${me.username}?tab=stories` : "/")}
          >
            <Sparkles size={20} className="flex-none" />
            My stories
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ROW} onSelect={() => router.push("/contacts")}>
            <UsersRound size={20} className="flex-none" />
            Contacts
          </DropdownMenu.Item>

          <DropdownMenu.Separator className={RULE} />

          <DropdownMenu.Item className={ROW} onSelect={() => router.push("/settings/site")}>
            <Palette size={20} className="flex-none" />
            Site settings
          </DropdownMenu.Item>

          {/* "More" opens in place rather than navigating, the way the reference expands it. */}
          <DropdownMenu.Item
            className={ROW}
            onSelect={(event) => {
              event.preventDefault();
              setMore((value) => !value);
            }}
          >
            <ChevronRight
              size={20}
              className={`flex-none transition-transform ${more ? "rotate-90" : ""}`}
            />
            More
          </DropdownMenu.Item>

          {more ? (
            <>
              <DropdownMenu.Item className={ROW} onSelect={() => router.push("/stars")}>
                <Star size={20} className="flex-none" />
                Stars
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ROW} onSelect={() => router.push("/communities")}>
                <Users size={20} className="flex-none" />
                Communities
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ROW} onSelect={() => openPremium()}>
                <Crown size={20} className="flex-none text-[var(--premium)]" />
                GRAM Premium
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={RULE} />
              <DropdownMenu.Item
                className={`${ROW} text-[var(--danger)]`}
                onSelect={() => {
                  clearSession();
                  queryClient.clear();
                  api.logout().finally(() => router.replace("/login"));
                }}
              >
                <LogOut size={20} className="flex-none" />
                Sign out
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
