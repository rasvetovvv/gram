# `bot/` — GRAM's Telegram Stars checkout

The site never takes a payment. It opens an order, hands the buyer a deep link into this bot, and
credits the wallet only when the bot reports a charge back. That keeps card handling, refunds and
Telegram's own rules on Telegram's side of the line.

## How one purchase runs

1. The buyer picks a pack in the wallet — `POST /api/stars/orders {package}`.
2. The API answers with the order and `bot_url` = `https://t.me/<bot>?start=<payload>`.
3. The bot reads the order (`GET /api/bot/orders/<payload>`) and sends an invoice in `XTR` for
   exactly `price_xtr`.
4. Telegram asks `pre_checkout_query`; the bot re-reads the order and refuses if it was cancelled,
   already paid, or the amount no longer matches.
5. On `successful_payment` the bot calls `POST /api/bot/orders/<payload>/paid` with the charge id.
   The API credits the wallet, writes the ledger line and notifies the buyer.

Paying once credits once: the API is idempotent on `telegram_charge_id`, because Telegram
re-delivers a successful payment when it is not sure the bot saw it.

## Running it

The bot needs no dependencies beyond `httpx`, which the API's virtualenv already has:

```bash
TELEGRAM_BOT_TOKEN=123456:AA... \
GRAM_API_URL=http://127.0.0.1:8000 \
BOT_API_SECRET=local-only-change-this-bot-secret \
GRAM_SITE_URL=http://localhost:3000 \
api/.venv/Scripts/python.exe bot/gram_stars_bot.py
```

| Variable | Meaning |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather. Without it the bot exits with code 2 rather than pretending to run. |
| `GRAM_API_URL` | Where the API lives. Inside compose that is `http://api:8000`. |
| `BOT_API_SECRET` | Shared with the API (`BOT_API_SECRET` there). The bot's only credential. |
| `GRAM_SITE_URL` | Used in the messages that point the buyer back at the wallet. |
| `TELEGRAM_ADMIN_ID` | Who decides refunds. Comma-separated Telegram ids; nobody else's button press is honoured. |

## Refunds

A buyer opens a refund in the receipt on `/stars`, with a reason. Nothing moves there — the request
lands in the database, and this bot is what carries it to a person:

1. Each poll cycle the bot asks `GET /api/bot/refunds/pending` for requests nobody has been shown
   yet. The API stamps them as it hands them over, so one request is announced once.
2. Every admin id gets the request as a message with two buttons: **Вернуть** and **Отклонить**.
   `/refunds` re-lists everything still open, in case a message was missed.
3. A press calls `POST /api/bot/refunds/<id>/decision`. The site checks the conditions again — the
   fourteen-day window, and that the credited stars are still on the balance — and **debits first**.
4. Only then does the bot call Telegram's `refundStarPayment`. If Telegram refuses, the bot calls
   `POST /api/bot/refunds/<id>/failed` and the site puts the stars back.

The order in step 3 and 4 is the whole point: refunding in Telegram first would leave a buyer
holding both halves whenever the debit turns out to be impossible.

Conditions live on the site, not here: **14 days** from the payment (`REFUND_WINDOW_DAYS`) and the
balance still holding at least the amount that was credited. Stars are fungible, so "unused" can
only honestly mean that.

A refund can also be answered in the site's admin panel instead of on these buttons. The money
moves there, but only a bot can call `refundStarPayment` — so the bot picks those up from
`GET /api/bot/refunds/approved` each cycle, refunds them, and reports back with
`POST /api/bot/refunds/<id>/settled`. A row leaves that queue only when the bot answers, which is
what keeps one approval from being refunded twice.

## Payouts — stars back out into Telegram

The shop read backwards at the same rate: 100 ★ leave as the 5 Telegram Stars they cost. A person
asks on `/stars`, an admin confirms **in the site's panel**, and the stars are held from the moment
of the request so they cannot be spent while the request waits.

The last step is the interesting one, because **Telegram has no method that sends Stars to a
person**. What it does have is `refundStarPayment`, and a charge handed back is Stars arriving in
the account that paid it. So:

1. `GET /api/bot/payouts/approved` — payouts an admin confirmed, handed over once (the API stamps
   them). Each row may carry `auto_charge_id`: a charge from that same account worth exactly what
   the payout owes, which nobody has handed back yet.
2. **With a charge** the bot refunds it and reports `POST /api/bot/payouts/<id>/paid` with
   `purchase_id`. The site marks that purchase `paid_out` — spent for good, never refundable again —
   and the payout is done with nobody in the loop. Measured end to end: ~15 seconds from request to
   Stars in Telegram.
3. **Without one** the payout becomes a message to every `TELEGRAM_ADMIN_ID` with the amount, the
   address and two buttons: **Отправлено** / **Не удалось**. The transfer itself is a person's job.
   `/payouts` re-lists everything still unsent.
4. **Не удалось** puts the stars back on the balance, because the site withheld them on the promise
   of a transfer that did not happen. The same two answers exist in the panel.

Exactly one charge is ever used, never a combination: two refunds cannot fail as one, and a
half-finished payout is worse than one that waits for a person. If the automatic attempt is refused
by Telegram, the bot says so and falls back to the manual card in the same cycle.

The API side needs two of its own:

| Variable | Meaning |
|---|---|
| `TELEGRAM_BOT_USERNAME` | Without `@`. It is what `bot_url` is built from, so a wrong value sends buyers to somebody else's bot. |
| `BOT_API_SECRET` | Must match the bot's. |

## Setting the bot up once

1. `@BotFather` → `/newbot` → take the token.
2. `/mybots` → the bot → **Payments** — nothing to connect for Stars: `XTR` needs no provider
   token, which is why `sendInvoice` here sends none.
3. Set the commands so the two that matter are discoverable:
   `/setcommands` → `start - купить звёзды`, `paysupport - вопросы по оплате`.
4. Put the token into the environment of whatever runs this file.

Two more commands exist for admins only and are deliberately left out of `/setcommands`, because
they are useless to everybody else: `/refunds` and `/payouts` re-list what is still open.

## `/paysupport`

Telegram expects a bot that takes payments to answer this command. It explains where the stars went
and asks for the charge id, which is what a support request is opened with.

## Long polling, not a webhook

Nothing here needs a public address, so the same file works on a laptop and on a server. To run it
behind a webhook instead, call `setWebhook` and feed the update JSON into `handle_message` /
`handle_pre_checkout` — both take a plain update object and hold no other state.
