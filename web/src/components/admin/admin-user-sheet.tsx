"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import {
  Ban,
  Check,
  Eraser,
  EyeOff,
  Gift as GiftIcon,
  Send,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AdminGiftItem, AdminInventory, AdminPostItem, AdminUser, AdminUsernameItem, VerificationTier } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { useToast } from "../ui/toast";

export const FIELD =
  "min-h-10 w-full min-w-0 rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--dim)]";
export const CHIP =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border-0 px-3 text-[13px] font-semibold transition active:scale-95 disabled:opacity-45";
export const QUIET = `${CHIP} bg-white/[0.07] text-[var(--ink)]`;
export const DANGER = `${CHIP} bg-[var(--danger)] text-white`;

/** Runs one staff action and reports it; every call site shares the same error handling. */
export type Act = <T>(label: string, call: () => Promise<T>) => Promise<T | undefined>;

const TIERS: { key: VerificationTier; label: string }[] = [
  { key: "official", label: "Official" },
  { key: "creator", label: "Creator" },
  { key: "signal", label: "Public figure" },
  { key: "founder", label: "Founder" }
];

/** A labelled block, so the sheet reads as sections rather than a wall of controls. */
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--line)] px-4 py-3.5">
      <h3 className="m-0 text-[13px] font-bold uppercase tracking-[.06em] text-[var(--faint)]">
        {title}
      </h3>
      {hint ? <p className="mb-0 mt-1 text-[12px] leading-4 text-[var(--dim)]">{hint}</p> : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** Who the account is, and the three decisions that change its standing. */
function ProfilePane({
  account,
  reason,
  act
}: {
  account: AdminUser;
  reason: string;
  act: Act;
}) {
  const [draft, setDraft] = useState({
    display_name: account.display_name,
    bio: account.bio ?? "",
    location: account.location ?? "",
    role_title: account.role_title ?? ""
  });
  const [stars, setStars] = useState("");
  const dirty =
    draft.display_name !== account.display_name ||
    draft.bio !== (account.bio ?? "") ||
    draft.location !== (account.location ?? "") ||
    draft.role_title !== (account.role_title ?? "");

  return (
    <>
      <Group title="How the profile looks" hint="Changes are visible to everyone immediately, as if the owner made them.">
        <div className="space-y-2">
          <input
            value={draft.display_name}
            onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
            placeholder="Name"
            className={FIELD}
          />
          <textarea
            value={draft.bio}
            onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
            placeholder="About"
            rows={2}
            className={`${FIELD} min-h-[64px] resize-y py-2`}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              placeholder="City"
              className={FIELD}
            />
            <input
              value={draft.role_title}
              onChange={(event) => setDraft({ ...draft, role_title: event.target.value })}
              placeholder="Tagline under the name"
              className={FIELD}
            />
          </div>
          <button
            type="button"
            disabled={!dirty}
            onClick={() =>
              act("Profile updated", () =>
                api.adminUpdateUser(account.username, {
                  display_name: draft.display_name.trim(),
                  bio: draft.bio,
                  location: draft.location.trim() || null,
                  role_title: draft.role_title.trim() || null,
                  reason: reason || undefined
                })
              )
            }
            className={`${QUIET} w-full justify-center`}
          >
            <Check size={14} />
            Save profile
          </button>
        </div>
      </Group>

      <Group title="Verification" hint="The tier is what shows in the tooltip behind the checkmark.">
        <div className="flex flex-wrap gap-1.5">
          {TIERS.map((tier) => (
            <button
              key={tier.key}
              type="button"
              onClick={() =>
                act(`Verification: ${tier.label.toLowerCase()}`, () =>
                  api.adminUpdateUser(account.username, {
                    is_verified: true,
                    verification_tier: tier.key,
                    reason: reason || undefined
                  })
                )
              }
              className={
                account.verification_tier === tier.key
                  ? `${CHIP} bg-[var(--verified)] text-white`
                  : QUIET
              }
            >
              <ShieldCheck size={13} />
              {tier.label}
            </button>
          ))}
          {account.is_verified ? (
            <button
              type="button"
              onClick={() =>
                act("Verification removed", () =>
                  api.adminUpdateUser(account.username, {
                    is_verified: false,
                    reason: reason || undefined
                  })
                )
              }
              className={`${CHIP} bg-white/[0.07] text-[var(--danger)]`}
            >
              <Undo2 size={13} />
              Remove
            </button>
          ) : null}
        </div>
      </Group>

      <Group title="Stars" hint="A negative amount deducts. The entry lands in the owner's wallet.">
        <div className="flex gap-2">
          <input
            value={stars}
            onChange={(event) => setStars(event.target.value)}
            inputMode="numeric"
            placeholder={`Currently ${account.stars_balance ?? 0} ★`}
            className={FIELD}
          />
          <button
            type="button"
            disabled={!Number.parseInt(stars, 10)}
            onClick={() =>
              act("Balance changed", () =>
                api.adminGrantStars(account.username, Number.parseInt(stars, 10), reason || undefined)
              ).then(() => setStars(""))
            }
            className={`${CHIP} bg-[var(--stars)] text-black`}
          >
            <Star size={13} />
            Apply
          </button>
        </div>
      </Group>

      <Group title="Permissions and ban">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              act(account.is_admin ? "Permissions revoked" : "Permissions granted", () =>
                api.adminUpdateUser(account.username, {
                  is_admin: !account.is_admin,
                  reason: reason || undefined
                })
              )
            }
            className={account.is_admin ? `${CHIP} bg-[var(--primary)] text-white` : QUIET}
          >
            <ShieldCheck size={13} />
            {account.is_admin ? "Revoke admin" : "Grant admin"}
          </button>
          {account.is_banned ? (
            <button
              type="button"
              onClick={() => act("Ban lifted", () => api.adminUnbanUser(account.username))}
              className={`${CHIP} bg-white/[0.07] text-[var(--online)]`}
            >
              <Undo2 size={13} />
              Unban
            </button>
          ) : (
            <button
              type="button"
              disabled={reason.trim().length < 3}
              onClick={() =>
                act(`@${account.username} banned`, () =>
                  api.adminBanUser(account.username, reason.trim())
                )
              }
              className={DANGER}
            >
              <Ban size={13} />
              Ban
            </button>
          )}
        </div>
        {!account.is_banned ? (
          <p className="mb-0 mt-2 text-[12px] text-[var(--dim)]">
            A ban needs a reason — the owner and anyone who opens the profile will see it.
          </p>
        ) : null}
      </Group>
    </>
  );
}

/** One collectible, with the four things staff can do to it. */
function GiftRow({ gift, reason, act }: { gift: AdminGiftItem; reason: string; act: Act }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  // The design's real pools: naming a variant Telegram never made would leave the tile blank.
  const design = useQuery({
    queryKey: ["gift-design", gift.design_slug],
    queryFn: () => api.giftDesign(gift.design_slug!),
    enabled: open && Boolean(gift.design_slug)
  });

  return (
    <li className="rounded-[14px] bg-white/[0.03] p-2.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="size-9 shrink-0 rounded-[10px]"
          style={{ background: gift.accent || "#1f1f26" }}
        />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[14px] font-bold">
            {gift.name} #{gift.serial_number}
          </strong>
          <span className="block truncate text-[12px] text-[var(--dim)]">
            {gift.upgraded ? gift.model_name || "upgraded" : "standard"}
            {gift.is_listed ? ` · on the market for ${gift.sale_price_stars} ★` : ""}
            {gift.transfers_count ? ` · transfers: ${gift.transfers_count}` : ""}
          </span>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className={QUIET}>
          {open ? "Hide" : "Edit"}
        </button>
      </div>

      {open ? (
        <div className="mt-2.5 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["model", "Model", design.data?.models],
                ["backdrop", "Backdrop", design.data?.backdrops],
                ["symbol", "Symbol", design.data?.symbols]
              ] as const
            ).map(([key, label, pool]) => (
              <select
                key={key}
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  void act(`${label} changed`, () =>
                    api.adminUpdateGift(gift.id, { [key]: value, reason: reason || undefined })
                  );
                }}
                aria-label={label}
                className={FIELD}
              >
                <option value="">{label}…</option>
                {(pool ?? []).map((variant) => (
                  <option key={variant.name} value={variant.name}>
                    {variant.name} · {variant.rarity_percent}%
                  </option>
                ))}
              </select>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="transfer to @whom"
              className={`${FIELD} max-w-[190px]`}
            />
            <button
              type="button"
              disabled={!target.trim()}
              onClick={() =>
                act("Gift transferred", () =>
                  api.adminTransferGift(gift.id, target.trim(), reason || undefined)
                ).then(() => setTarget(""))
              }
              className={QUIET}
            >
              <Send size={13} />
              Transfer
            </button>
            {gift.upgraded ? (
              <button
                type="button"
                onClick={() =>
                  act("Upgrade removed", () =>
                    api.adminUpdateGift(gift.id, { upgraded: false, reason: reason || undefined })
                  )
                }
                className={QUIET}
              >
                <Undo2 size={13} />
                Remove upgrade
              </button>
            ) : null}
            <button
              type="button"
              disabled={reason.trim().length < 3}
              onClick={() =>
                act("History cleared", () =>
                  api.adminClearGiftHistory(gift.id, reason.trim())
                )
              }
              className={QUIET}
            >
              <Eraser size={13} />
              Clear history
            </button>
            <button
              type="button"
              onClick={() =>
                act("Gift revoked", () => api.adminRevokeGift(gift.id, reason || undefined))
              }
              className={DANGER}
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The collection, plus the form that hands over a new one with a chosen variant. */
function GiftsPane({
  account,
  inventory,
  reason,
  act
}: {
  account: AdminUser;
  inventory: AdminInventory | undefined;
  reason: string;
  act: Act;
}) {
  const [slug, setSlug] = useState("");
  const [upgraded, setUpgraded] = useState(true);
  const [model, setModel] = useState("");
  const designs = useQuery({
    queryKey: ["admin-designs", slug],
    queryFn: () => api.adminDesigns(slug.trim() || undefined),
    enabled: true
  });
  const chosen = useQuery({
    queryKey: ["gift-design", slug],
    queryFn: () => api.giftDesign(slug),
    enabled: Boolean(slug) && designs.data?.some((item) => item.slug === slug)
  });

  return (
    <>
      <Group
        title="Grant a gift"
        hint="You can pick a model — then it's a prize, not a lottery ticket."
      >
        <div className="space-y-2">
          <input
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value.trim());
              setModel("");
            }}
            placeholder="design slug, e.g. plush-pepe"
            list="admin-design-slugs"
            className={FIELD}
          />
          <datalist id="admin-design-slugs">
            {(designs.data ?? []).slice(0, 40).map((design) => (
              <option key={design.slug} value={design.slug}>
                {design.name} · {design.remaining} left
              </option>
            ))}
          </datalist>
          {chosen.data ? (
            <select value={model} onChange={(event) => setModel(event.target.value)} className={FIELD}>
              <option value="">Random model</option>
              {chosen.data.models.map((variant) => (
                <option key={variant.name} value={variant.name}>
                  {variant.name} · {variant.rarity_percent}%
                </option>
              ))}
            </select>
          ) : null}
          <label className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={upgraded}
              onChange={(event) => setUpgraded(event.target.checked)}
            />
            Upgraded right away
          </label>
          <button
            type="button"
            disabled={!slug}
            onClick={() =>
              act("Gift granted", () =>
                api.adminGrantGift(account.username, slug, upgraded || Boolean(model), reason || undefined, model || undefined)
              ).then(() => setModel(""))
            }
            className={`${QUIET} w-full justify-center`}
          >
            <GiftIcon size={14} />
            Grant to @{account.username}
          </button>
        </div>
      </Group>

      <Group title={`Collection · ${inventory?.gifts.length ?? 0}`}>
        {inventory?.gifts.length ? (
          <ul className="m-0 list-none space-y-2 p-0">
            {inventory.gifts.map((gift) => (
              <GiftRow key={gift.id} gift={gift} reason={reason} act={act} />
            ))}
          </ul>
        ) : (
          <p className="mb-0 text-[13px] text-[var(--muted)]">No gifts</p>
        )}
      </Group>
    </>
  );
}

/** Handles the account holds: hand over, move on, wipe the trail, take back. */
function UsernamesPane({
  account,
  inventory,
  reason,
  act
}: {
  account: AdminUser;
  inventory: AdminInventory | undefined;
  reason: string;
  act: Act;
}) {
  const [handle, setHandle] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  return (
    <>
      <Group title="Assign a username" hint="If the username doesn't exist yet, it will be created.">
        <div className="flex gap-2">
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="username without @"
            className={FIELD}
          />
          <button
            type="button"
            disabled={!handle.trim()}
            onClick={() =>
              act("Username assigned", () =>
                api.adminGrantUsername(account.username, handle.trim(), reason || undefined)
              ).then(() => setHandle(""))
            }
            className={QUIET}
          >
            <Tag size={13} />
            Assign
          </button>
        </div>
      </Group>

      <Group title={`Usernames · ${inventory?.usernames.length ?? 0}`}>
        {inventory?.usernames.length ? (
          <ul className="m-0 list-none space-y-2 p-0">
            {inventory.usernames.map((item: AdminUsernameItem) => (
              <li key={item.username} className="rounded-[14px] bg-white/[0.03] p-2.5">
                <div className="flex items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate text-[14px] font-bold">
                    @{item.username}
                  </strong>
                  {item.is_primary ? (
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                      primary
                    </span>
                  ) : null}
                  {item.history_count ? (
                    <span className="text-[12px] text-[var(--dim)]">
                      history: {item.history_count}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <input
                    value={targets[item.username] ?? ""}
                    onChange={(event) =>
                      setTargets({ ...targets, [item.username]: event.target.value })
                    }
                    placeholder="transfer to @whom"
                    className={`${FIELD} max-w-[190px]`}
                  />
                  <button
                    type="button"
                    disabled={!(targets[item.username] ?? "").trim()}
                    onClick={() =>
                      act("Username transferred", () =>
                        api.adminTransferUsername(
                          item.username,
                          (targets[item.username] ?? "").trim(),
                          reason || undefined
                        )
                      )
                    }
                    className={QUIET}
                  >
                    <Send size={13} />
                    Transfer
                  </button>
                  <button
                    type="button"
                    disabled={reason.trim().length < 3 || !item.history_count}
                    onClick={() =>
                      act("Username history cleared", () =>
                        api.adminClearUsernameHistory(item.username, reason.trim())
                      )
                    }
                    className={QUIET}
                  >
                    <Eraser size={13} />
                    Clear history
                  </button>
                  {item.is_primary ? null : (
                    <button
                      type="button"
                      onClick={() =>
                        act("Username revoked", () =>
                          api.adminRevokeUsername(account.username, item.username)
                        )
                      }
                      className={DANGER}
                    >
                      <Trash2 size={13} />
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-0 text-[13px] text-[var(--muted)]">No usernames</p>
        )}
      </Group>
    </>
  );
}

/** What the account wrote, with hide as the default and delete as the exception. */
function PostsPane({
  inventory,
  reason,
  act
}: {
  inventory: AdminInventory | undefined;
  reason: string;
  act: Act;
}) {
  return (
    <Group
      title={`Posts · ${inventory?.posts.length ?? 0}`}
      hint="A hidden post is visible only to its author and admins. Deletion cannot be undone."
    >
      {inventory?.posts.length ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {inventory.posts.map((post: AdminPostItem) => (
            <li key={post.id} className="rounded-[14px] bg-white/[0.03] p-2.5">
              <Link href={`/post/${post.id}`} className="block">
                <p className="mb-0 line-clamp-2 text-[14px] leading-5">{post.content}</p>
              </Link>
              <span className="mt-1 block text-[12px] text-[var(--dim)]">
                {relativeTime(post.created_at)}
                {post.community_slug ? ` · /c/${post.community_slug}` : ""}
                {post.reports_count ? ` · reports: ${post.reports_count}` : ""}
                {post.hidden_at ? ` · hidden: ${post.hidden_reason ?? "no reason"}` : ""}
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {post.hidden_at ? (
                  <button
                    type="button"
                    onClick={() => act("Post restored", () => api.adminRestorePost(post.id))}
                    className={QUIET}
                  >
                    <Undo2 size={13} />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={reason.trim().length < 3}
                    onClick={() =>
                      act("Post hidden", () => api.adminHidePost(post.id, reason.trim()))
                    }
                    className={QUIET}
                  >
                    <EyeOff size={13} />
                    Hide
                  </button>
                )}
                <button
                  type="button"
                  disabled={reason.trim().length < 3}
                  onClick={() =>
                    act("Post deleted", () => api.adminDeletePost(post.id, reason.trim()))
                  }
                  className={DANGER}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-0 text-[13px] text-[var(--muted)]">No posts</p>
      )}
    </Group>
  );
}

/** The one action with nothing left to review afterwards, so it asks twice. */
function DangerPane({ account, act, onClose }: { account: AdminUser; act: Act; onClose: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [why, setWhy] = useState("");
  const [communities, setCommunities] = useState<"transfer" | "delete">("transfer");
  const ready = confirm.trim().replace(/^@/, "").toLowerCase() === account.username.toLowerCase();
  return (
    <Group
      title="Delete account"
      hint="Irreversible: posts, comments, gifts and conversations will disappear. Usernames return to the free pool."
    >
      <div className="space-y-2">
        <input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder={`Type @${account.username} to confirm`}
          className={FIELD}
        />
        <input
          value={why}
          onChange={(event) => setWhy(event.target.value)}
          placeholder="Reason — required"
          className={FIELD}
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCommunities("transfer")}
            className={communities === "transfer" ? `${CHIP} bg-[var(--primary)] text-white` : QUIET}
          >
            Communities — to me
          </button>
          <button
            type="button"
            onClick={() => setCommunities("delete")}
            className={communities === "delete" ? `${CHIP} bg-[var(--primary)] text-white` : QUIET}
          >
            Communities — delete
          </button>
        </div>
        <button
          type="button"
          disabled={!ready || why.trim().length < 3}
          onClick={() =>
            act(`@${account.username} deleted`, () =>
              api.adminDeleteAccount(account.username, {
                confirm_username: confirm.trim().replace(/^@/, ""),
                reason: why.trim(),
                communities
              })
            ).then((result) => {
              if (result) onClose();
            })
          }
          className={`${DANGER} w-full justify-center`}
        >
          <Trash2 size={14} />
          Delete account permanently
        </button>
      </div>
    </Group>
  );
}

type Tab = "profile" | "gifts" | "usernames" | "posts" | "danger";

/**
 * Everything staff can do to one account, in one sheet.
 *
 * The panel used to hang these controls off a list row, which meant judging somebody through a
 * keyhole: no bio, no collection, no posts, and a reason field that scrolled away. Here the
 * account is the subject of the screen, the reason is typed once and reused by every action, and
 * the sections match what there is to decide — who they are, what they hold, what they wrote, and
 * the one irreversible thing.
 */
export function AdminUserSheet({
  username,
  open,
  onClose
}: {
  username: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<Tab>("profile");
  const [reason, setReason] = useState("");

  const user = useQuery({
    queryKey: ["admin-user", username],
    queryFn: () => api.adminUser(username),
    enabled: open
  });
  const inventory = useQuery({
    queryKey: ["admin-inventory", username],
    queryFn: () => api.adminInventory(username),
    enabled: open && tab !== "profile" && tab !== "danger"
  });

  const act: Act = async (label, call) => {
    try {
      const result = await call();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-user", username] }),
        queryClient.invalidateQueries({ queryKey: ["admin-inventory", username] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", username] })
      ]);
      notify(label, { variant: "success" });
      return result;
    } catch (error) {
      notify("Something went wrong", { variant: "error", detail: (error as Error).message });
      return undefined;
    }
  };

  const account = user.data;
  const counts: Record<Tab, number | null> = {
    profile: null,
    gifts: inventory.data?.gifts.length ?? account?.gifts_count ?? null,
    usernames: inventory.data?.usernames.length ?? account?.usernames_count ?? null,
    posts: inventory.data?.posts.length ?? account?.posts_count ?? null,
    danger: null
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[88] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 top-[max(2.5rem,env(safe-area-inset-top))] z-[89] mx-auto flex w-full max-w-[680px] flex-col overflow-hidden rounded-t-[24px] bg-[var(--sheet)] text-[var(--ink)] shadow-[0_-16px_60px_rgba(0,0,0,.6)] outline-none"
        >
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, y: 18 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex flex-none items-center gap-3 border-b border-[var(--sheet-line)] px-4 py-3">
              {account ? (
                <UserAvatar src={account.avatar_url} name={account.display_name} size={40} />
              ) : null}
              <div className="min-w-0 flex-1">
                <Dialog.Title className="m-0 flex items-center gap-1.5 text-[16px] font-bold leading-tight">
                  <span className="truncate">{account?.display_name ?? username}</span>
                  {account?.is_verified ? (
                    <ShieldCheck size={14} className="shrink-0 text-[var(--verified)]" />
                  ) : null}
                  {account?.is_banned ? (
                    <span className="shrink-0 rounded-full bg-[rgba(229,57,53,.16)] px-1.5 text-[11px] font-bold text-[var(--danger)]">
                      ban
                    </span>
                  ) : null}
                </Dialog.Title>
                <Link
                  href={`/u/${username}`}
                  className="block truncate text-[13px] text-[var(--dim)]"
                >
                  @{username} · {account?.stars_balance ?? 0} ★
                  {account?.open_reports_count ? ` · reports: ${account.open_reports_count}` : ""}
                </Link>
              </div>
              <Dialog.Close className="grid size-9 flex-none place-items-center rounded-full border-0 bg-transparent text-[var(--muted)] transition active:bg-white/10">
                <X size={20} />
              </Dialog.Close>
            </div>

            {/* Typed once, reused by every action below — and required by the destructive ones. */}
            <div className="flex-none border-b border-[var(--sheet-line)] px-4 py-2.5">
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason — logged and sent to the owner in a notification"
                className={FIELD}
              />
            </div>

            <div
              role="tablist"
              className="flex flex-none gap-1 overflow-x-auto border-b border-[var(--sheet-line)] px-2 py-2"
            >
              {(
                [
                  ["profile", "Profile"],
                  ["gifts", "Gifts"],
                  ["usernames", "Usernames"],
                  ["posts", "Posts"],
                  ["danger", "Danger"]
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={
                    tab === key
                      ? `${CHIP} ${key === "danger" ? "bg-[var(--danger)]" : "bg-[var(--primary)]"} text-white`
                      : `${CHIP} bg-transparent text-[var(--muted)]`
                  }
                >
                  {label}
                  {counts[key] ? (
                    <span className="rounded-full bg-black/25 px-1.5 text-[11px]">{counts[key]}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10">
              {!account ? (
                <p className="px-4 py-8 text-center text-[var(--muted)]">Loading account…</p>
              ) : tab === "profile" ? (
                <ProfilePane account={account} reason={reason} act={act} />
              ) : tab === "gifts" ? (
                <GiftsPane account={account} inventory={inventory.data} reason={reason} act={act} />
              ) : tab === "usernames" ? (
                <UsernamesPane
                  account={account}
                  inventory={inventory.data}
                  reason={reason}
                  act={act}
                />
              ) : tab === "posts" ? (
                <PostsPane inventory={inventory.data} reason={reason} act={act} />
              ) : (
                <DangerPane account={account} act={act} onClose={onClose} />
              )}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
