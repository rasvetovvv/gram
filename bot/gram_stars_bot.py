"""
GRAM's own Telegram bot. It sells site stars for Telegram Stars and nothing else.

The site never takes a payment: it opens an order, hands the buyer a deep link, and waits. This
process is the other half — it reads the order, sends a Telegram Stars invoice for exactly the
price the order names, and reports the charge back with its id. The site credits on that report.

Why Stars (`XTR`) and no provider token: Telegram's own currency needs none, and it is the only
one that works inside the app on every platform. `provider_token` is deliberately empty.

Run it against a local API:

    TELEGRAM_BOT_TOKEN=123:abc GRAM_API_URL=http://127.0.0.1:8000 \
        BOT_API_SECRET=... api/.venv/Scripts/python.exe bot/gram_stars_bot.py

Long polling rather than a webhook on purpose: it needs no public address, so the same file works
on a laptop and on a server. `README.md` beside it explains the deployment either way.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import sys
from typing import Any

import httpx

LOG = logging.getLogger("gram.bot")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
API_URL = os.getenv("GRAM_API_URL", "https://vexory.xyz").rstrip("/")
API_SECRET = os.getenv("BOT_API_SECRET", "local-only-change-this-bot-secret")
SITE_URL = os.getenv("GRAM_SITE_URL", "https://vexory.xyz").rstrip("/")
# Who may decide a refund. A Telegram id rather than a site role: the decision is taken here, in
# a chat, and the button has to be pressable by exactly one known person.
ADMIN_IDS = frozenset(
    int(part) for part in os.getenv("TELEGRAM_ADMIN_ID", "944763501").split(",") if part.strip()
)
# Telegram holds the request open until something happens, so a long timeout is the quiet path.
POLL_SECONDS = 25
HTTP_TIMEOUT = httpx.Timeout(POLL_SECONDS + 10)

WELCOME = (
    "Это платёжный бот GRAM.\n\n"
    "Звёзды покупаются на сайте: выберите набор в кошельке, и я пришлю счёт "
    "в Telegram Stars. После оплаты звёзды зачисляются на аккаунт сразу.\n\n"
    f"Кошелёк: {SITE_URL}/stars"
)

PAY_SUPPORT = (
    "Оплата проходит в Telegram Stars и зачисляется на аккаунт GRAM сразу после платежа.\n\n"
    "Если звёзды не пришли — пришлите сюда номер операции из чека Telegram, "
    "и мы разберёмся вручную. Возврат Telegram Stars делается только по этому номеру."
)


class Telegram:
    """The three Bot API calls this bot needs, and nothing more."""

    def __init__(self, client: httpx.AsyncClient, token: str) -> None:
        self._client = client
        self._base = f"https://api.telegram.org/bot{token}"

    async def call(self, method: str, **payload: Any) -> Any:
        response = await self._client.post(f"{self._base}/{method}", json=payload)
        body = response.json()
        if not body.get("ok"):
            LOG.error("telegram %s failed: %s", method, body.get("description"))
            return None
        return body.get("result")

    async def send(self, chat_id: int, text: str) -> None:
        await self.call("sendMessage", chat_id=chat_id, text=text, disable_web_page_preview=True)

    async def ask(self, chat_id: int, text: str, buttons: list[list[dict[str, str]]]) -> None:
        """A message that carries its own decision, so an admin never has to type an id."""
        await self.call(
            "sendMessage",
            chat_id=chat_id,
            text=text,
            disable_web_page_preview=True,
            reply_markup={"inline_keyboard": buttons},
        )

    async def answer_callback(self, query_id: str, text: str = "") -> None:
        await self.call("answerCallbackQuery", callback_query_id=query_id, text=text)

    async def refund_stars(self, user_id: int, charge_id: str) -> tuple[bool, str]:
        """Telegram's own refund. True when the Stars went back to the buyer."""
        response = await self._client.post(
            f"{self._base}/refundStarPayment",
            json={"user_id": user_id, "telegram_payment_charge_id": charge_id},
        )
        body = response.json()
        if body.get("ok"):
            return True, "refunded"
        return False, str(body.get("description", "Telegram отказал в возврате"))

    async def send_invoice(self, chat_id: int, order: dict[str, Any]) -> None:
        """
        One invoice per order, priced in Telegram Stars.

        `payload` carries the order's own token, so the payment that comes back can be matched to
        the order without trusting anything the buyer typed.
        """
        await self.call(
            "sendInvoice",
            chat_id=chat_id,
            title=f"{order['stars']} звёзд GRAM",
            description=(
                f"Зачисление {order['stars']} ★ на аккаунт @{order['buyer_username']} "
                "сразу после оплаты."
            ),
            payload=order["payload"],
            currency="XTR",
            prices=[{"label": f"{order['stars']} ★", "amount": order["price_xtr"]}],
        )


class GramApi:
    """The site, as far as the bot is concerned: read an order, report a charge."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client
        self._headers = {"X-Bot-Secret": API_SECRET}

    async def order(self, payload: str) -> dict[str, Any] | None:
        response = await self._client.get(
            f"{API_URL}/api/bot/orders/{payload}", headers=self._headers
        )
        if response.status_code == httpx.codes.NOT_FOUND:
            return None
        response.raise_for_status()
        return response.json()

    async def report_payment(
        self, payload: str, *, user_id: int, charge_id: str, amount: int
    ) -> tuple[bool, str]:
        """True with the detail when the site credited it, False with the reason when it did not."""
        response = await self._client.post(
            f"{API_URL}/api/bot/orders/{payload}/paid",
            headers=self._headers,
            json={
                "telegram_user_id": user_id,
                "telegram_charge_id": charge_id,
                "amount_xtr": amount,
            },
        )
        if response.is_success:
            return True, str(response.json().get("detail", "credited"))
        detail = "Не удалось зачислить звёзды"
        with contextlib.suppress(ValueError):
            detail = str(response.json().get("detail", detail))
        return False, detail

    async def refunds(self, *, announced: bool) -> list[dict[str, Any]]:
        """
        Refund requests waiting for an answer.

        `announced=False` asks for the ones nobody has been shown yet — the API stamps them on the
        way out, so an admin is asked once rather than on every sweep. `True` is the full open list,
        for the `/refunds` command.
        """
        path = "open" if announced else "pending"
        response = await self._client.get(
            f"{API_URL}/api/bot/refunds/{path}", headers=self._headers
        )
        response.raise_for_status()
        return list(response.json())

    async def decide_refund(
        self, refund_id: str, *, approved: bool, admin_id: int, note: str = ""
    ) -> tuple[bool, dict[str, Any] | str]:
        """The site's half of a decision. It debits before Telegram is asked for anything."""
        response = await self._client.post(
            f"{API_URL}/api/bot/refunds/{refund_id}/decision",
            headers=self._headers,
            json={"approved": approved, "admin_telegram_id": admin_id, "note": note},
        )
        if response.is_success:
            return True, dict(response.json())
        detail = "Не удалось применить решение"
        with contextlib.suppress(ValueError):
            detail = str(response.json().get("detail", detail))
        return False, detail

    async def refund_failed(self, refund_id: str, note: str) -> None:
        """Telegram refused after the debit — the site puts the stars back."""
        await self._client.post(
            f"{API_URL}/api/bot/refunds/{refund_id}/failed",
            headers=self._headers,
            params={"note": note[:240]},
        )

    async def approved_refunds(self) -> list[dict[str, Any]]:
        """
        Refunds the site has debited for and Telegram has not been asked about yet.

        These are the ones decided in the admin panel: the panel can move stars but it cannot call
        `refundStarPayment`, so the Telegram half is picked up here. A row leaves the list only when
        this bot reports back, which is what keeps one approval from being refunded twice.
        """
        response = await self._client.get(
            f"{API_URL}/api/bot/refunds/approved", headers=self._headers
        )
        response.raise_for_status()
        return list(response.json())

    async def refund_settled(self, refund_id: str) -> None:
        """Telegram gave the payment back. Stamped so it is never asked for again."""
        await self._client.post(
            f"{API_URL}/api/bot/refunds/{refund_id}/settled", headers=self._headers
        )

    async def payouts(self, *, announced: bool) -> list[dict[str, Any]]:
        """
        Withdrawals an admin has confirmed on the site.

        Same two lists as refunds: `announced=False` is the batch nobody has been shown, stamped on
        the way out; `True` is everything still unsent, for `/payouts`.
        """
        path = "open" if announced else "approved"
        response = await self._client.get(
            f"{API_URL}/api/bot/payouts/{path}", headers=self._headers
        )
        response.raise_for_status()
        return list(response.json())

    async def settle_payout(
        self, payout_id: str, *, sent: bool, admin_id: int, note: str = "", purchase_id: str = ""
    ) -> tuple[bool, str]:
        """
        Report the end of a payout: sent keeps the stars off, failed puts them back.

        `purchase_id` is the charge this bot handed back to carry the payout out by itself. The site
        marks it spent, so the same money can never be refunded a second time.
        """
        body: dict[str, Any] = {"admin_telegram_id": admin_id, "note": note}
        if purchase_id:
            body["purchase_id"] = purchase_id
        response = await self._client.post(
            f"{API_URL}/api/bot/payouts/{payout_id}/{'paid' if sent else 'failed'}",
            headers=self._headers,
            json=body,
        )
        if response.is_success:
            return True, str(response.json().get("detail", "ok"))
        detail = "Не удалось отметить заявку"
        with contextlib.suppress(ValueError):
            detail = str(response.json().get("detail", detail))
        return False, detail


async def handle_start(telegram: Telegram, api: GramApi, chat_id: int, argument: str) -> None:
    """`/start <payload>` is the deep link the site's sheet opens."""
    if not argument:
        await telegram.send(chat_id, WELCOME)
        return
    order = await api.order(argument)
    if order is None:
        await telegram.send(
            chat_id,
            "Заказ не найден. Откройте кошелёк GRAM и выберите набор заново — "
            f"{SITE_URL}/stars",
        )
        return
    if order["status"] == "paid":
        await telegram.send(chat_id, f"Этот заказ уже оплачен: {order['stars']} ★ зачислены.")
        return
    if order["status"] != "pending":
        await telegram.send(
            chat_id,
            "Ссылка больше не действует — заказ закрыт. "
            f"Оформите новый в кошельке: {SITE_URL}/stars",
        )
        return
    await telegram.send_invoice(chat_id, order)


async def handle_pre_checkout(telegram: Telegram, api: GramApi, query: dict[str, Any]) -> None:
    """
    The last chance to refuse before Telegram takes the money.

    The order is re-read here rather than trusted from the invoice: it may have been cancelled or
    already paid in the seconds the buyer spent on the confirmation screen.
    """
    payload = str(query.get("invoice_payload", ""))
    order = await api.order(payload)
    if order is None or order["status"] != "pending":
        await telegram.call(
            "answerPreCheckoutQuery",
            pre_checkout_query_id=query["id"],
            ok=False,
            error_message="Заказ закрыт. Оформите новый в кошельке GRAM.",
        )
        return
    if int(query.get("total_amount", 0)) != int(order["price_xtr"]):
        await telegram.call(
            "answerPreCheckoutQuery",
            pre_checkout_query_id=query["id"],
            ok=False,
            error_message="Сумма не совпадает с заказом.",
        )
        return
    await telegram.call("answerPreCheckoutQuery", pre_checkout_query_id=query["id"], ok=True)


async def handle_successful_payment(
    telegram: Telegram, api: GramApi, chat_id: int, user_id: int, payment: dict[str, Any]
) -> None:
    """Telegram has charged; the site credits on this report and only on this report."""
    payload = str(payment.get("invoice_payload", ""))
    charge_id = str(payment.get("telegram_payment_charge_id", ""))
    amount = int(payment.get("total_amount", 0))
    credited, detail = await api.report_payment(
        payload, user_id=user_id, charge_id=charge_id, amount=amount
    )
    if credited:
        order = await api.order(payload)
        stars = order["stars"] if order else "—"
        await telegram.send(
            chat_id,
            f"Оплачено. {stars} ★ зачислены на аккаунт GRAM.\n\n"
            f"Кошелёк: {SITE_URL}/stars",
        )
        return
    LOG.error("payment %s not credited: %s", charge_id, detail)
    await telegram.send(
        chat_id,
        f"Платёж прошёл, но звёзды не зачислились: {detail}\n\n"
        f"Номер операции: {charge_id}\nНапишите /paysupport — разберёмся вручную.",
    )


async def handle_message(telegram: Telegram, api: GramApi, message: dict[str, Any]) -> None:
    chat_id = int(message["chat"]["id"])
    user_id = int(message.get("from", {}).get("id", 0))
    if "successful_payment" in message:
        await handle_successful_payment(
            telegram, api, chat_id, user_id, message["successful_payment"]
        )
        return
    text = str(message.get("text", "")).strip()
    command, _, argument = text.partition(" ")
    command = command.split("@", 1)[0].lower()
    if command == "/start":
        await handle_start(telegram, api, chat_id, argument.strip())
    elif command == "/paysupport":
        await telegram.send(chat_id, PAY_SUPPORT)
    elif command == "/refunds":
        await handle_refund_list(telegram, api, chat_id, user_id)
    elif command == "/payouts":
        await handle_payout_list(telegram, api, chat_id, user_id)
    elif command in {"/help", "/stars"} or text:
        await telegram.send(chat_id, WELCOME)


def _refund_card(refund: dict[str, Any]) -> str:
    """One request, written so an admin can decide without opening anything else."""
    asked = str(refund.get("requested_at", ""))[:16].replace("T", " ")
    return (
        "Заявка на возврат\n\n"
        f"Покупатель: {refund['buyer_display_name']} (@{refund['buyer_username']})\n"
        f"Сумма: {refund['stars']} ★ за {refund['price_xtr']} Telegram Stars\n"
        f"Запрошено: {asked} UTC\n\n"
        f"Причина: {refund['reason']}"
    )


def _refund_buttons(refund_id: str) -> list[list[dict[str, str]]]:
    return [
        [
            {"text": "Вернуть", "callback_data": f"refund_ok:{refund_id}"},
            {"text": "Отклонить", "callback_data": f"refund_no:{refund_id}"},
        ]
    ]


async def handle_refund_list(
    telegram: Telegram, api: GramApi, chat_id: int, user_id: int
) -> None:
    """`/refunds` — the open list, in case a sweep message was missed."""
    if user_id not in ADMIN_IDS:
        await telegram.send(chat_id, "Эта команда только для администратора.")
        return
    try:
        refunds = await api.refunds(announced=True)
    except httpx.HTTPError as error:
        await telegram.send(chat_id, f"Сайт недоступен: {error}")
        return
    if not refunds:
        await telegram.send(chat_id, "Открытых заявок на возврат нет.")
        return
    for refund in refunds:
        await telegram.ask(chat_id, _refund_card(refund), _refund_buttons(str(refund["id"])))


async def announce_refunds(telegram: Telegram, api: GramApi) -> None:
    """
    Hand every new request to the admins, once.

    The site cannot reach into Telegram, so the bot asks for what is new each cycle; the API marks
    a request announced as it hands it over, which is what keeps this from repeating itself.
    """
    if not ADMIN_IDS:
        return
    try:
        refunds = await api.refunds(announced=False)
    except httpx.HTTPError as error:
        LOG.warning("refund sweep failed: %s", error)
        return
    for refund in refunds:
        for admin_id in ADMIN_IDS:
            await telegram.ask(admin_id, _refund_card(refund), _refund_buttons(str(refund["id"])))


def _payout_card(payout: dict[str, Any]) -> str:
    """
    One withdrawal, written as an instruction rather than a notification.

    Telegram has no API that sends Stars to a person, so this is a job for whoever reads it: the
    amount, the address, and then the two buttons that report what happened.
    """
    where = (
        f"@{payout['telegram_username']}"
        if payout.get("telegram_username")
        else f"Telegram id {payout['telegram_user_id']}"
        if payout.get("telegram_user_id")
        else "адрес не указан — спросите у автора заявки"
    )
    return (
        "Вывод подтверждён на сайте\n\n"
        f"Кому: {payout['display_name']} (@{payout['username']})\n"
        f"Сумма: {payout['stars']} ★ → {payout['price_xtr']} Telegram Stars\n"
        f"Куда: {where}\n\n"
        f"Отправьте {payout['price_xtr']} Telegram Stars и отметьте кнопкой ниже. "
        "Если отправить не удалось, звёзды вернутся автору."
    )

def _payout_buttons(payout_id: str) -> list[list[dict[str, str]]]:
    return [
        [
            {"text": "Отправлено", "callback_data": f"payout_ok:{payout_id}"},
            {"text": "Не удалось", "callback_data": f"payout_no:{payout_id}"},
        ]
    ]


async def announce_payouts(telegram: Telegram, api: GramApi) -> None:
    """
    Deal with every payout an admin has confirmed on the site.

    Most of them need nobody: when the site names a charge of exactly the right size, handing that
    charge back *is* the transfer — `refundStarPayment` returns Telegram Stars to the same account
    that paid them, which is the only way the Bot API can move Stars towards a person. That path is
    taken first, and only what it cannot do becomes a message with two buttons.
    """
    try:
        payouts = await api.payouts(announced=False)
    except httpx.HTTPError as error:
        LOG.warning("payout sweep failed: %s", error)
        return
    for payout in payouts:
        payout_id = str(payout["id"])
        charge = str(payout.get("auto_charge_id") or "")
        buyer = int(payout.get("telegram_user_id") or 0)
        if charge and buyer:
            returned, note = await telegram.refund_stars(buyer, charge)
            if returned:
                ok, detail = await api.settle_payout(
                    payout_id,
                    sent=True,
                    admin_id=buyer,
                    note=f"Автоматически: возвращён платёж на {payout['price_xtr']} Telegram Stars",
                    purchase_id=str(payout.get("auto_purchase_id") or ""),
                )
                LOG.info("payout %s settled automatically: %s %s", payout_id, ok, detail)
                for admin_id in ADMIN_IDS:
                    await telegram.send(
                        admin_id,
                        f"Вывод исполнен автоматически: @{payout['username']} получил "
                        f"{payout['price_xtr']} Telegram Stars ({payout['stars']} ★ списаны).",
                    )
                continue
            LOG.warning("automatic payout %s refused by telegram: %s", payout_id, note)
            for admin_id in ADMIN_IDS:
                await telegram.send(
                    admin_id,
                    f"Автоматический вывод не прошёл: {note}. Отправьте вручную — заявка ниже.",
                )
        if not ADMIN_IDS:
            LOG.warning("payout %s needs a person and no admin id is configured", payout_id)
            continue
        for admin_id in ADMIN_IDS:
            await telegram.ask(admin_id, _payout_card(payout), _payout_buttons(payout_id))


async def handle_payout_list(
    telegram: Telegram, api: GramApi, chat_id: int, user_id: int
) -> None:
    """`/payouts` — everything confirmed and not yet sent."""
    if user_id not in ADMIN_IDS:
        await telegram.send(chat_id, "Эта команда только для администратора.")
        return
    try:
        payouts = await api.payouts(announced=True)
    except httpx.HTTPError as error:
        await telegram.send(chat_id, f"Сайт недоступен: {error}")
        return
    if not payouts:
        await telegram.send(chat_id, "Подтверждённых выводов в ожидании нет.")
        return
    for payout in payouts:
        await telegram.ask(chat_id, _payout_card(payout), _payout_buttons(str(payout["id"])))


async def settle_panel_refunds(telegram: Telegram, api: GramApi) -> None:
    """
    Carry out the Telegram half of refunds approved in the admin panel.

    The panel moves the stars; only a bot can call `refundStarPayment`. A success is stamped so the
    row leaves the queue, and a refusal goes through the same compensation as a refund decided here.
    """
    try:
        refunds = await api.approved_refunds()
    except httpx.HTTPError as error:
        LOG.warning("approved refund sweep failed: %s", error)
        return
    for refund in refunds:
        buyer = int(refund.get("telegram_user_id") or 0)
        charge = str(refund.get("telegram_charge_id") or "")
        refund_id = str(refund["id"])
        if not buyer or not charge:
            await api.refund_failed(refund_id, "Платёж без идентификатора charge")
            continue
        refunded, note = await telegram.refund_stars(buyer, charge)
        if refunded:
            await api.refund_settled(refund_id)
            LOG.info("refunded %s XTR for @%s", refund.get("price_xtr"), refund["buyer_username"])
            for admin_id in ADMIN_IDS:
                await telegram.send(
                    admin_id,
                    f"Возврат исполнен: {refund['price_xtr']} Telegram Stars вернулись "
                    f"@{refund['buyer_username']}.",
                )
            continue
        await api.refund_failed(refund_id, note)
        for admin_id in ADMIN_IDS:
            await telegram.send(
                admin_id,
                f"Telegram отказал в возврате для @{refund['buyer_username']}: {note}. "
                "Звёзды вернулись на баланс сайта.",
            )


async def handle_callback(telegram: Telegram, api: GramApi, query: dict[str, Any]) -> None:
    """An admin's press: «Вернуть»/«Отклонить» on a refund, «Отправлено»/«Не удалось» on a payout."""
    data = str(query.get("data", ""))
    admin_id = int(query.get("from", {}).get("id", 0))
    chat_id = int(query.get("message", {}).get("chat", {}).get("id", admin_id))
    if admin_id not in ADMIN_IDS:
        await telegram.answer_callback(query["id"], "Решение принимает администратор")
        return
    action, _, target_id = data.partition(":")
    if action in {"payout_ok", "payout_no"} and target_id:
        await _handle_payout_press(
            telegram, api, query, chat_id, admin_id, target_id, sent=action == "payout_ok"
        )
        return
    if action not in {"refund_ok", "refund_no"} or not target_id:
        await telegram.answer_callback(query["id"])
        return
    refund_id = target_id
    approved = action == "refund_ok"
    applied, result = await api.decide_refund(
        refund_id,
        approved=approved,
        admin_id=admin_id,
        note="" if approved else "Отклонено администратором",
    )
    if not applied:
        await telegram.answer_callback(query["id"], "Не вышло")
        await telegram.send(chat_id, f"Заявка не применена: {result}")
        return
    if not approved:
        await telegram.answer_callback(query["id"], "Отклонено")
        await telegram.send(chat_id, "Отклонено. Покупатель уведомлён.")
        return
    # The site has already debited, so Telegram is asked last and a refusal is compensated.
    details = result if isinstance(result, dict) else {}
    buyer = int(details.get("telegram_user_id") or 0)
    charge = str(details.get("telegram_charge_id") or "")
    if not buyer or not charge:
        await api.refund_failed(refund_id, "Платёж без идентификатора charge")
        await telegram.send(chat_id, "У платежа нет charge id — возврат отменён, звёзды вернулись.")
        return
    refunded, note = await telegram.refund_stars(buyer, charge)
    if refunded:
        await telegram.answer_callback(query["id"], "Возвращено")
        await telegram.send(
            chat_id,
            f"Возврат выполнен: {details.get('price_xtr')} Telegram Stars отправлены обратно, "
            f"{details.get('stars')} ★ списаны с баланса сайта.",
        )
        return
    await api.refund_failed(refund_id, note)
    await telegram.answer_callback(query["id"], "Telegram отказал")
    await telegram.send(chat_id, f"Telegram отказал в возврате: {note}. Звёзды вернулись на баланс.")


async def _handle_payout_press(
    telegram: Telegram,
    api: GramApi,
    query: dict[str, Any],
    chat_id: int,
    admin_id: int,
    payout_id: str,
    *,
    sent: bool,
) -> None:
    """
    «Отправлено» or «Не удалось» on a payout.

    Nothing about Telegram Stars can be automated here — the transfer was made by hand — so this
    only records which of the two happened. Sent keeps the stars off the balance; failed returns
    them, because the site withheld them on the promise of a transfer that did not happen.
    """
    ok, detail = await api.settle_payout(
        payout_id,
        sent=sent,
        admin_id=admin_id,
        note="" if sent else "Не удалось отправить Telegram Stars",
    )
    if not ok:
        await telegram.answer_callback(query["id"], "Не вышло")
        await telegram.send(chat_id, f"Заявка не отмечена: {detail}")
        return
    await telegram.answer_callback(query["id"], "Отправлено" if sent else "Возвращено")
    await telegram.send(
        chat_id,
        "Вывод отмечен как отправленный. Автор заявки уведомлён."
        if sent
        else "Вывод помечен как неудавшийся — звёзды вернулись автору заявки.",
    )


async def run() -> int:
    if not BOT_TOKEN:
        sys.stderr.write(
            "TELEGRAM_BOT_TOKEN is not set.\n"
            "Create a bot with @BotFather, then run this file with the token in the environment.\n"
        )
        return 2
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # httpx logs the full Bot API URL at INFO level, and Telegram embeds the bot token in that
    # path. Keep transport noise out of Docker logs so the credential is never persisted there.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        telegram = Telegram(client, BOT_TOKEN)
        api = GramApi(client)
        me = await telegram.call("getMe")
        if me is None:
            sys.stderr.write("The token was refused by Telegram.\n")
            return 3
        LOG.info("running as @%s against %s", me.get("username"), API_URL)
        offset: int | None = None
        while True:
            try:
                updates = await telegram.call(
                    "getUpdates",
                    offset=offset,
                    timeout=POLL_SECONDS,
                    allowed_updates=["message", "pre_checkout_query", "callback_query"],
                )
            except httpx.HTTPError as error:  # a dropped poll is normal; the next one continues
                LOG.warning("poll failed: %s", error)
                await asyncio.sleep(3)
                continue
            for update in updates or []:
                offset = int(update["update_id"]) + 1
                try:
                    if "pre_checkout_query" in update:
                        await handle_pre_checkout(telegram, api, update["pre_checkout_query"])
                    elif "callback_query" in update:
                        await handle_callback(telegram, api, update["callback_query"])
                    elif "message" in update:
                        await handle_message(telegram, api, update["message"])
                except Exception:
                    LOG.exception("update %s failed", update.get("update_id"))
            # Refund requests arrive on the site, not in Telegram, so each cycle asks for them.
            await announce_refunds(telegram, api)
            # Approvals taken in the admin panel need their Telegram half done here, and confirmed
            # payouts need a person told about them. Both are site-side events too.
            await settle_panel_refunds(telegram, api)
            await announce_payouts(telegram, api)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        raise SystemExit(asyncio.run(run()))
