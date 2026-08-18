# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, React, TypeScript, Tailwind CSS, Framer Motion, Radix UI / shadcn-ui, Zustand, TanStack Query, React Hook Form, Zod, and a modern Python/FastAPI API with PostgreSQL. The complete local environment must run in Docker.

## Users

GRAM is for people who want one durable identity for private conversation, public posting, communities, creator subscriptions, collectible usernames, and digital gifts. The product is mobile-first and expands into a capable multi-column desktop workspace.

## Product Purpose

GRAM combines a personalized feed, private chats, expressive user and community profiles, collectible gifts, Stars, paid subscriptions, and a username marketplace. Success means a new person can register, establish an identity, publish, subscribe, message, own an asset, and see every action survive reload and a new session.

## Positioning

Identity is an active social asset. Usernames, private notes, verification, profile styling, featured gifts, subscriptions, and collectibles live directly in profiles and conversation instead of feeling like a detached marketplace.

## Operating Context

People register and sign in, complete a short profile setup, browse recommendations or subscriptions, publish posts, open profiles, follow creators and communities, exchange messages, reserve usernames, spend Stars, and display or transfer collectible gifts. Phones use an inset five-destination dock; desktop uses a persistent rail, a 720–780 px working column, and a contextual right rail when useful.

## Capabilities and Constraints

- Authentication is real and app-owned: registration, login, secure password hashes, persistent refresh sessions, logout, session revocation, validation, and explicit error/loading states.
- Onboarding includes a unique username, display name, avatar upload, optional interests, and a recoverable completion state.
- Required social surfaces: recommended/subscriptions feed, posts, chats, user profiles, communities/channels, notifications, settings, creator studio, Stars wallet, username ownership, and collectible gifts.
- Profiles include separate avatar and cover media, presence, main and related usernames, verification, premium/collectible status, bio, links, badges, join date, counters, public collection, a private per-viewer note, and content tabs.
- A user can select one featured collectible for the cover and one compact collectible marker beside the name. These never replace verification or premium status.
- Collectible gifts have an edition number, supply, model, symbol, background, rarity traits, value, owner, acquisition time, and immutable transfer/provenance records. Ownership-changing operations are atomic and confirmed.
- Usernames have unique ownership and explicit states: available, owned, reserved, listed, and transferring. Acquisition and transfer history must be durable.
- Stars use an atomic ledger with credit, spend, refund, balance, and history rather than a UI-only counter. Stars can fund creator subscriptions and supported collectible/username actions in the local product economy.
- Communities have owner/admin/member/subscriber roles, a profile, posts, membership state, counters, media/gift tabs, and optional paid access.
- Chat, post, profile media, follows, notes, memberships, transactions, and ownership data persist in PostgreSQL and remain correct after reload and re-login.
- Livestream/“эфир” functionality and its visual language are explicitly out of scope and must be removed. Stories, voice calls, and video calls are separate features and remain valid product directions.
- The local build simulates Stars settlement and NFT-like collectible ownership. It must not claim Telegram, TON, blockchain minting, real-money settlement, E2EE, or official Telegram assets without those systems actually being integrated and verified.
- Interface copy is Russian-first and prepared for later localization.

## Brand Commitments

Working product name: GRAM. The supplied `refer/` set is the visual and interaction authority: almost-black canvas, softly elevated graphite surfaces, broad 20–30 px section radii, capsule controls, cyan links, violet primary actions, gold Stars, green presence, full-width profile covers, overlapping avatars, and collectible objects positioned as identity layers. GRAM borrows the legibility and rounded interaction grammar of modern Telegram-style interfaces without copying its logo or presenting itself as an official Telegram client.

## Evidence on Hand

- Original mobile profile reference: `C:/Users/losha/AppData/Local/Temp/codex-clipboard-cdc365b4-645b-4873-956f-924bd280387a.png`.
- Fifty-two supplied product references in `C:/Users/losha/OneDrive/Documents/ChatGPT/gram]/refer/` cover auth, onboarding, feed, posts, profiles, messages, communities, Stars, creator analytics, username detail, and collectible gift galleries/details.
- No production logo, licensed Telegram gift asset library, payment processor, blockchain contract, moderation operation, email provider, or production object storage has been supplied. Local catalog art and seeded balances are illustrative and labelled as such.

## Product Principles

- Every prominent control must produce a durable state change, open a complete flow, or be honestly marked unavailable.
- Identity should be legible, ownable, expressive, and consistent across profile, feed, chat, and community surfaces.
- Scarcity mechanics must show ownership, supply, price, and provenance without ambiguity.
- Private notes stay visible only to their author.
- Monetization always shows exact Star amounts and a transaction result.
- Dense functionality stays comfortable on a phone and never sits underneath fixed navigation.

## Accessibility & Inclusion

Keyboard access, visible focus, reduced-motion support, semantic controls, predictable error messages, and WCAG AA contrast are required. Status, verification, rarity, and transaction direction cannot rely on color alone.
