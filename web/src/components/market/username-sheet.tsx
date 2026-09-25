"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  BadgeCheck,
  Check,
  Copy,
  Gavel,
  Hash,
  History,
  LogOut,
  Send,
  ShieldCheck,
  Star,
  Store,
  Tag,
  X
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { UsernameAsset } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
import { TopUpButton } from "../stars/top-up-button";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/** What a line of ownership history says, in the words the market uses elsewhere. */
const ACTION_LABEL: Record<string, string> = {
  acquired: "Bought",
  offer_accepted: "Sold via bid",
  listed: "Listed for sale",
  unlisted: "Removed from sale",
  reserved: "Reserved",
  registered: "Taken at registration",
  profile_username: "Became primary",
  released_handle: "Kept with the account",
  released: "Released",
  transferred: "Transferred",
  community_username: "Given to a channel",
  community_released: "Unlinked from channel",
  community_primary: "Became the channel address",
  admin_granted: "Granted by admins",
  admin_transferred: "Transferred by admins"
};

const OFFER_STATUS: Record<string, string> = {
  pending: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled"
};

/** Every stars figure in the market is written the same way. */
function stars(amount: number) {
  return `${new Intl.NumberFormat("en-US").format(amount)} ★`;
}

/**
 * One handle, and everything its owner or a buyer can do with it.
 *
 * The market's whole surface lives here rather than in the list: a row has to stay readable at a
 * glance, and a handle carries a sale price, standing bids, a channel it may be pointing at and
 * a trail of everyone who has held it.
 */
export function UsernameSheet({
  asset,
  open,
  onClose,
  mine
}: {
  asset: UsernameAsset;
  open: boolean;
  onClose: () => void;
  mine: boolean;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [price, setPrice] = useState(String(asset.price ?? 250));
  const [bid, setBid] = useState(String(asset.price ?? 250));
  const [recipient, setRecipient] = useState("");
  const [confirmBuy, setConfirmBuy] = useState(false);
  // Giving a handle up is the one action here nobody can undo — the name goes back on the shelf and
  // the next person to want it can take it — so the button asks once before it does that.
  const [confirmRelease, setConfirmRelease] = useState(false);

  const history = useQuery({
    queryKey: ["username-history", asset.id],
    queryFn: () => api.usernameHistory(asset.id),
    enabled: open
  });
  const offers = useQuery({
    queryKey: ["username-offers", asset.id],
    queryFn: () => api.usernameOffers(asset.id),
    enabled: open
  });
  // Only an owner is ever offered the "give it to one of my channels" control, so the channel
  // list is only fetched for them.
  const channels = useQuery({
    queryKey: ["my-communities"],
    queryFn: api.myCommunities,
    enabled: open && mine
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["usernames"] }),
      queryClient.invalidateQueries({ queryKey: ["username-offers", asset.id] }),
      queryClient.invalidateQueries({ queryKey: ["my-username-offers"] }),
      queryClient.invalidateQueries({ queryKey: ["username-history", asset.id] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["communities"] }),
      queryClient.invalidateQueries({ queryKey: ["my-communities"] })
    ]);
  }

  /** Every market action fails the same way: with the reason the server actually gave. */
  const fail = (title: string) => (error: Error) =>
    notify(title, { variant: "error", detail: error.message });

  const list = useMutation({
    mutationFn: () => api.updateListing(asset.id, true, Number(price)),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} listed for ${stars(Number(price))}`, { variant: "success" });
    },
    onError: fail("Couldn't list")
  });
  const unlist = useMutation({
    mutationFn: () => api.updateListing(asset.id, false),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} removed from sale`, { variant: "success" });
    },
    onError: fail("Couldn't remove from sale")
  });
  const keep = useMutation({
    mutationFn: (disabled: boolean) => api.updateUsernameOffersPolicy(asset.id, disabled),
    onSuccess: async (_result, disabled) => {
      await refresh();
      notify(disabled ? "Offers disabled" : "Offers accepted again", {
        variant: "success",
        detail: disabled ? "Bids that were placed have been returned" : undefined
      });
    },
    onError: fail("Something went wrong")
  });
  const activate = useMutation({
    mutationFn: () => api.activateUsername(asset.id),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} is now your primary username`, { variant: "success" });
      onClose();
    },
    onError: fail("Couldn't set as primary")
  });
  const transfer = useMutation({
    mutationFn: () => api.transferUsername(asset.id, recipient.trim()),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} transferred to @${recipient.trim().replace(/^@/, "")}`, {
        variant: "success"
      });
      setRecipient("");
      onClose();
    },
    onError: fail("Couldn't transfer")
  });
  const release = useMutation({
    mutationFn: () => api.releaseUsername(asset.id),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} released`, {
        variant: "success",
        detail: "The name is free again — anyone can take it"
      });
      setConfirmRelease(false);
      onClose();
    },
    onError: fail("Couldn't release")
  });
  const buy = useMutation({
    mutationFn: () => api.purchaseUsername(asset.id),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} is now yours`, {
        variant: "success",
        detail: `${stars(asset.price ?? 0)} charged`
      });
      onClose();
    },
    onError: fail("Couldn't buy")
  });
  const offer = useMutation({
    mutationFn: () => api.offerForUsername(asset.id, Number(bid)),
    onSuccess: async () => {
      await refresh();
      notify(`Bid of ${stars(Number(bid))} sent`, {
        variant: "success",
        detail: "Stars are held until the owner responds"
      });
    },
    onError: fail("Bid didn't go through")
  });
  const withdraw = useMutation({
    mutationFn: (offerId: string) => api.withdrawUsernameOffer(offerId),
    onSuccess: async (result) => {
      await refresh();
      notify(result.detail, { variant: "success", detail: "Stars are back on your balance" });
    },
    onError: fail("Couldn't withdraw the bid")
  });
  const accept = useMutation({
    mutationFn: (offerId: string) => api.acceptUsernameOffer(offerId),
    onSuccess: async (result) => {
      await refresh();
      notify(`@${asset.username} sold`, {
        variant: "success",
        detail: `Buyer @${result.owner_username}`
      });
      onClose();
    },
    onError: fail("Couldn't accept the bid")
  });
  const decline = useMutation({
    mutationFn: (offerId: string) => api.declineUsernameOffer(offerId),
    onSuccess: async (result) => {
      await refresh();
      notify("Bid declined", {
        variant: "success",
        detail: `${stars(result.amount_stars)} returned to the buyer`
      });
    },
    onError: fail("Couldn't decline")
  });
  const attach = useMutation({
    mutationFn: (slug: string) => api.attachCommunityUsername(slug, asset.username),
    onSuccess: async (community) => {
      await refresh();
      notify(`@${asset.username} is the address for the “${community.title}” channel`, { variant: "success" });
    },
    onError: fail("Couldn't give to channel")
  });
  const detach = useMutation({
    mutationFn: () => api.detachCommunityUsername(asset.community_slug!, asset.id),
    onSuccess: async () => {
      await refresh();
      notify(`@${asset.username} is just yours again`, { variant: "success" });
    },
    onError: fail("Couldn't unlink")
  });
  const makeChannelAddress = useMutation({
    mutationFn: () => api.setCommunityPrimaryUsername(asset.community_slug!, asset.id),
    onSuccess: async (community) => {
      await refresh();
      notify(`The channel now opens at @${community.slug}`, { variant: "success" });
    },
    onError: fail("Couldn't change the channel address")
  });

  const standing = (offers.data ?? []).filter((item) => item.status === "pending");
  const myOffer = standing.find((item) => item.is_mine);
  const listed = asset.status === "listed" && asset.price != null;
  const ownedByChannel = Boolean(asset.community_slug);
  const busy =
    list.isPending ||
    unlist.isPending ||
    buy.isPending ||
    offer.isPending ||
    accept.isPending ||
    decline.isPending;

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    notify(message, { variant: "success" });
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`@${asset.username}`}
      description={`Collectible username · ${asset.username.length} chars`}
      headerRight={
        <Dialog.Close className="icon-button !size-9 bg-[#27272a]" aria-label="Close">
          <X size={18} />
        </Dialog.Close>
      }
    >
      <div className="pt-1">
        <h2 className="m-0 text-2xl font-extrabold tracking-[-0.03em] text-[var(--link)]">
          @{asset.username}
        </h2>
        <p className="mb-0 mt-1 flex flex-wrap items-center gap-1.5 text-sm text-[var(--muted)]">
          {listed ? (
            <span className="rounded-full bg-[#342813] px-2 py-0.5 text-[11px] font-extrabold text-[var(--stars)]">
              {stars(asset.price ?? 0)}
            </span>
          ) : null}
          {asset.is_primary_handle ? (
            <span className="rounded-full bg-[#1b2a3a] px-2 py-0.5 text-[11px] font-extrabold text-[var(--link)]">
              primary
            </span>
          ) : null}
          {ownedByChannel ? (
            <span className="rounded-full bg-[#1f2a20] px-2 py-0.5 text-[11px] font-extrabold text-[var(--online)]">
              {asset.is_community_primary ? "channel address" : "with a channel"}
            </span>
          ) : null}
          {asset.offers_disabled ? (
            <span className="rounded-full bg-[#2a2024] px-2 py-0.5 text-[11px] font-extrabold text-[var(--muted)]">
              not for sale
            </span>
          ) : null}
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-[20px] bg-[#27272a]">
        <Fact label="Owner">
          {asset.owner ? (
            <span className="flex items-center gap-2">
              <UserAvatar src={asset.owner.avatar_url} name={asset.owner.display_name} size={22} />
              @{asset.owner_username}
            </span>
          ) : (
            "Available"
          )}
        </Fact>
        {ownedByChannel ? (
          <Fact label="Channel">
            <span className="flex items-center gap-1.5">
              <Hash size={14} className="text-[var(--online)]" />
              {asset.community_title} · @{asset.community_slug}
            </span>
          </Fact>
        ) : null}
        <Fact label="Acquired">
          {new Intl.DateTimeFormat("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric"
          }).format(new Date(asset.acquired_at))}
        </Fact>
        <Fact label="Bids">
          {standing.length
            ? `${standing.length} · best ${stars(asset.top_offer_stars ?? 0)}`
            : asset.offers_disabled
              ? "Owner isn't accepting"
              : "None yet"}
        </Fact>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="quiet-button !px-3" onClick={() => copy(`@${asset.username}`, "Username copied")}>
          <Copy size={17} />
          Copy
        </button>
        <button
          className="quiet-button !px-3"
          onClick={() =>
            copy(
              `${window.location.origin}/market#username-${asset.username}`,
              "Listing link copied"
            )
          }
        >
          <AtSign size={17} />
          Listing link
        </button>
      </div>

      {mine ? (
        <>
          <section className="mt-4 rounded-[22px] bg-[#27272a] p-4">
            <h3 className="m-0 flex items-center gap-2 text-base font-bold">
              <Tag size={16} className="text-[var(--stars)]" />
              {listed ? "Listing on sale" : "List for sale"}
            </h3>
            <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
              {asset.is_primary_handle
                ? "This is your primary username — set another name as primary first."
                : asset.is_community_primary
                  ? "This is the channel address — choose another address for the channel first."
                  : "Ownership passes to the buyer only after an atomic payment."}
            </p>
            <label className="field mt-3 flex items-center gap-2 px-3">
              <Star size={17} className="text-[var(--stars)]" fill="currentColor" />
              <input
                type="number"
                min={10}
                max={1_000_000}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                aria-label="Price in stars"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button
                className="gold-button flex-1"
                disabled={busy || Number(price) < 10}
                onClick={() => list.mutate()}
              >
                <Gavel size={17} />
                {listed ? "Update price" : "List"}
              </button>
              {listed ? (
                <button className="quiet-button flex-1" disabled={busy} onClick={() => unlist.mutate()}>
                  Remove
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-[14px] border-0 bg-[#1f1f24] px-3 py-2.5 text-left text-sm transition hover:brightness-125"
              disabled={keep.isPending}
              onClick={() => keep.mutate(!asset.offers_disabled)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <ShieldCheck size={16} className={asset.offers_disabled ? "text-[var(--online)]" : "text-[var(--muted)]"} />
                {asset.offers_disabled ? "Accept offers again" : "Not for sale: disable bids"}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                {asset.offers_disabled
                  ? "Bids on this name are currently disabled"
                  : "Disabling returns stars to everyone who has already bid"}
              </span>
            </button>
          </section>

          <section className="mt-3 rounded-[22px] bg-[#27272a] p-4">
            <h3 className="m-0 flex items-center gap-2 text-base font-bold">
              <Hash size={16} className="text-[var(--online)]" />
              To a channel or profile
            </h3>
            {ownedByChannel ? (
              <>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  The name opens the “{asset.community_title}” channel.
                  {asset.is_community_primary ? " It's its primary address." : ""}
                </p>
                <div className="mt-3 flex gap-2">
                  {asset.is_community_primary ? null : (
                    <button
                      className="quiet-button flex-1"
                      disabled={makeChannelAddress.isPending}
                      onClick={() => makeChannelAddress.mutate()}
                    >
                      Make it the address
                    </button>
                  )}
                  <button
                    className="quiet-button flex-1"
                    disabled={detach.isPending || asset.is_community_primary}
                    onClick={() => detach.mutate()}
                  >
                    Unlink
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  Give the name to your channel — it will open by this name too.
                </p>
                {channels.data?.filter((item) => item.is_owner).length ? (
                  <div className="mt-3 space-y-2">
                    {channels.data
                      .filter((item) => item.is_owner)
                      .map((item) => (
                        <button
                          key={item.slug}
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-[14px] border-0 bg-[#1f1f24] px-3 py-2.5 text-left transition hover:brightness-125"
                          disabled={attach.isPending || asset.status === "listed"}
                          onClick={() => attach.mutate(item.slug)}
                        >
                          <UserAvatar src={item.avatar_url} name={item.title} size={28} radius="9px" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{item.title}</span>
                            <span className="block truncate text-xs text-[var(--muted)]">
                              @{item.slug}
                            </span>
                          </span>
                          <Send size={16} className="flex-none text-[var(--muted)]" />
                        </button>
                      ))}
                  </div>
                ) : (
                  <p className="mb-0 mt-2 text-xs text-[var(--dim)]">
                    You don&apos;t have any channels yet.
                  </p>
                )}
                {asset.is_primary_handle ? null : (
                  <button
                    className="quiet-button mt-2 w-full"
                    disabled={activate.isPending || asset.status === "listed"}
                    onClick={() => activate.mutate()}
                  >
                    <BadgeCheck size={17} />
                    Set as primary username
                  </button>
                )}
              </>
            )}
          </section>

          <section className="mt-3 rounded-[22px] bg-[#27272a] p-4">
            <h3 className="m-0 flex items-center gap-2 text-base font-bold">
              <Send size={16} className="text-[var(--link)]" />
              Transfer without payment
            </h3>
            <label className="field mt-3 flex items-center px-3">
              <span className="mr-1 font-bold text-[var(--link)]">@</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="recipient"
                aria-label="Transfer to"
                autoCapitalize="none"
                autoCorrect="off"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <button
              className="quiet-button mt-3 w-full"
              disabled={transfer.isPending || recipient.trim().length < 3}
              onClick={() => transfer.mutate()}
            >
              {transfer.isPending ? "Transferring…" : "Transfer name"}
            </button>
          </section>

          {/* The way out that needs nobody else. Hidden for the two handles the server refuses to
              free — your own address and a channel's — because there the button could only fail. */}
          {asset.is_primary_handle || asset.is_community_primary ? null : (
            <section className="mt-3 rounded-[22px] bg-[#27272a] p-4">
              <h3 className="m-0 flex items-center gap-2 text-base font-bold">
                <LogOut size={16} className="text-[var(--danger)]" />
                Release name
              </h3>
              <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                {confirmRelease
                  ? `@${asset.username} will no longer be yours and will become free — anyone can take it. You'll only be able to get it back by claiming it again, if no one beats you to it.`
                  : "The name will leave your collection and become free again. Its slot in your collection frees up."}
              </p>
              {confirmRelease ? (
                <div className="mt-3 flex gap-2">
                  <button
                    className="quiet-button flex-1"
                    disabled={release.isPending}
                    onClick={() => setConfirmRelease(false)}
                  >
                    Keep it
                  </button>
                  <button
                    className="inline-flex min-h-9 flex-1 items-center justify-center rounded-full border-0 bg-[var(--danger)] px-4 text-base font-medium text-white transition-transform active:scale-[.97] disabled:opacity-50"
                    disabled={release.isPending}
                    onClick={() => release.mutate()}
                  >
                    {release.isPending ? "Releasing…" : "Yes, release"}
                  </button>
                </div>
              ) : (
                <button
                  className="quiet-button mt-3 w-full text-[var(--danger)]"
                  onClick={() => setConfirmRelease(true)}
                >
                  Release @{asset.username}
                </button>
              )}
            </section>
          )}

          {standing.length ? (
            <section className="mt-3">
              <h3 className="m-0 text-base font-bold">Bids on this name</h3>
              <div className="mt-3 space-y-2">
                {standing.map((item) => (
                  <div key={item.id} className="rounded-[18px] bg-[#27272a] p-3">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar
                        src={item.bidder.avatar_url}
                        name={item.bidder.display_name}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {item.bidder.display_name}
                        </span>
                        <span className="block truncate text-xs text-[var(--muted)]">
                          @{item.bidder.username} · {relativeTime(item.created_at)}
                        </span>
                      </span>
                      <strong className="flex-none text-sm text-[var(--stars)]">
                        {stars(item.amount_stars)}
                      </strong>
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        className="gold-button flex-1 !min-h-10"
                        disabled={busy}
                        onClick={() => accept.mutate(item.id)}
                      >
                        <Check size={16} />
                        Accept
                      </button>
                      <button
                        className="quiet-button flex-1 !min-h-10"
                        disabled={busy}
                        onClick={() => decline.mutate(item.id)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="mt-4 space-y-3">
          {listed ? (
            confirmBuy ? (
              <div className="rounded-[22px] bg-[#2b2024] p-4">
                <p className="m-0 text-sm leading-5">
                  Buy <strong>@{asset.username}</strong> for{" "}
                  <strong>{stars(asset.price ?? 0)}</strong>? The name will transfer to you right away.
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="quiet-button flex-1" onClick={() => setConfirmBuy(false)}>
                    Back
                  </button>
                  <button className="gold-button flex-1" disabled={busy} onClick={() => buy.mutate()}>
                    {buy.isPending ? "Buying…" : "Confirm"}
                  </button>
                </div>
                {/* Stars may run short — the payment opens on top without losing the selected listing. */}
                <TopUpButton label="Top up stars" className="quiet-button mt-2 w-full" />
              </div>
            ) : (
              <button className="gold-button w-full" onClick={() => setConfirmBuy(true)}>
                <Star size={17} fill="currentColor" />
                Buy for {stars(asset.price ?? 0)}
              </button>
            )
          ) : null}

          {asset.owner ? (
            <div className="rounded-[22px] bg-[#27272a] p-4">
              <h3 className="m-0 flex items-center gap-2 text-base font-bold">
                <Store size={16} className="text-[var(--stars)]" />
                {myOffer ? "Your bid" : "Make an offer"}
              </h3>
              {asset.offers_disabled ? (
                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                  The owner marked the name as not for sale — bids aren&apos;t accepted.
                </p>
              ) : myOffer ? (
                <>
                  <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                    {stars(myOffer.amount_stars)} held until the owner responds ·{" "}
                    {relativeTime(myOffer.created_at)}
                  </p>
                  <button
                    className="quiet-button mt-3 w-full"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(myOffer.id)}
                  >
                    {withdraw.isPending ? "Withdrawing…" : "Withdraw bid"}
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                    Stars are held from the moment you bid and are returned if the owner declines.
                    {standing.length
                      ? ` The best bid right now is ${stars(asset.top_offer_stars ?? 0)}.`
                      : ""}
                  </p>
                  <label className="field mt-3 flex items-center gap-2 px-3">
                    <Star size={17} className="text-[var(--stars)]" fill="currentColor" />
                    <input
                      type="number"
                      min={10}
                      max={1_000_000}
                      value={bid}
                      onChange={(event) => setBid(event.target.value)}
                      aria-label="Bid in stars"
                      className="min-w-0 flex-1 bg-transparent outline-none"
                    />
                  </label>
                  <button
                    className="gold-button mt-3 w-full"
                    disabled={busy || Number(bid) < 10}
                    onClick={() => offer.mutate()}
                  >
                    <Gavel size={17} />
                    {offer.isPending ? "Sending…" : "Offer"}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </section>
      )}

      <section className="mt-5">
        <h3 className="m-0 text-base font-bold">Ownership history</h3>
        <div className="mt-3 space-y-2">
          {history.isLoading ? (
            <div className="skeleton h-14 rounded-[18px]" />
          ) : history.data?.length ? (
            history.data.map((event) => (
              <div key={event.id} className="flex items-center gap-3 rounded-[18px] bg-[#27272a] p-3">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-[#1f1f24] text-[var(--primary-strong)]">
                  <History size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">
                    {ACTION_LABEL[event.action] ?? event.action}
                  </strong>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {event.to_user ? `@${event.to_user.username}` : "GRAM"}
                    {event.from_user ? ` ← @${event.from_user.username}` : ""} ·{" "}
                    {relativeTime(event.created_at)}
                  </span>
                </span>
                {event.price_stars ? (
                  <span className="flex-none text-xs font-bold text-[var(--stars)]">
                    {stars(event.price_stars)}
                  </span>
                ) : null}
              </div>
            ))
          ) : (
            <p className="m-0 text-sm text-[var(--muted)]">No history yet.</p>
          )}
        </div>
      </section>

      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck size={16} className="text-[var(--online)]" />
        Every ownership change and every bid stays in the history
      </div>
    </BottomSheet>
  );
}

/** One labelled line of a handle's card. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-13 items-center gap-3 border-b border-[var(--line)] px-4 last:border-b-0">
      <span className="w-24 flex-none text-sm text-[var(--muted)]">{label}</span>
      <strong className="min-w-0 flex-1 truncate text-sm font-semibold">{children}</strong>
    </div>
  );
}

export { OFFER_STATUS, stars };

