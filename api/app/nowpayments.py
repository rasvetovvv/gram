"""
NOWPayments client: crypto top-ups and crypto payouts.

Design notes that matter more than the code:

*   **Nothing is credited on a webhook's word.** An IPN callback is treated as a hint that
    something changed, never as proof of it. Every credit is decided by our own authenticated
    `GET /v1/payment/{id}` call. That removes the entire class of "forged callback credits a
    wallet" bugs, and it means the integration works before an IPN secret is configured at all.
*   **Minimums are per coin and enormous in spread.** At the time of writing USDT-TRC20 needs
    about $11.47 to move, while USDT-BSC needs about $0.07 — for the same nominal dollar. A shop
    that lists every coin for every pack therefore sells payments that cannot be made. The coin
    list is filtered against the live minimum for the amount actually being paid.
*   **Rates are quoted, not invented.** The pack price is in UAH; how much crypto that is comes
    from NOWPayments' own estimate, so what the buyer is asked for matches what the network is
    told to expect.

Every response is validated into a small dataclass before it leaves this module: the rest of the
app must not have to know that this provider answers `"finished"` in a field called
`payment_status`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import (
    NOWPAYMENTS_API_BASE,
    NOWPAYMENTS_API_KEY,
    NOWPAYMENTS_IPN_SECRET,
    NOWPAYMENTS_TIMEOUT_SECONDS,
)

# The provider answers business refusals with a 4xx and a machine-readable `code`; anything at or
# above this is an error rather than a payload.
HTTP_ERROR_FLOOR = 400

# What a NOWPayments payment can be, mapped onto the three outcomes a wallet cares about.
#
# `finished` is the only status that credits. `confirming`/`confirmed`/`sending` are money on its
# way and must not credit twice; `partially_paid` is a real underpayment and needs a human, not an
# automatic credit; the rest are dead ends.
PAID_STATUSES = frozenset({"finished"})
IN_FLIGHT_STATUSES = frozenset({"waiting", "confirming", "confirmed", "sending"})
DEAD_STATUSES = frozenset({"failed", "refunded", "expired"})
ATTENTION_STATUSES = frozenset({"partially_paid"})


class NowPaymentsError(RuntimeError):
    """A provider call that did not answer the way the caller needs it to."""

    def __init__(
        self, message: str, *, status_code: int | None = None, code: str | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True, slots=True)
class CoinMinimum:
    """The smallest amount of one coin the provider will accept, and its fiat worth."""

    currency: str
    min_amount: float
    fiat_equivalent: float | None


@dataclass(frozen=True, slots=True)
class Estimate:
    """How much crypto a fiat amount buys, as the provider itself quotes it."""

    currency_from: str
    amount_from: float
    currency_to: str
    estimated_amount: float


@dataclass(frozen=True, slots=True)
class PaymentRecord:
    """A crypto payment as the provider sees it, in the fields we actually use."""

    payment_id: str
    payment_status: str
    pay_address: str
    pay_amount: float
    pay_currency: str
    price_amount: float
    price_currency: str
    order_id: str | None
    actually_paid: float
    outcome_amount: float | None
    # Some chains need a memo/tag as well as an address; omitting it loses the payment.
    payin_extra_id: str | None
    network: str | None
    expiration_estimate_date: str | None

    @property
    def is_paid(self) -> bool:
        return self.payment_status in PAID_STATUSES

    @property
    def is_dead(self) -> bool:
        return self.payment_status in DEAD_STATUSES

    @property
    def needs_attention(self) -> bool:
        return self.payment_status in ATTENTION_STATUSES


@dataclass(frozen=True, slots=True)
class PayoutRecord:
    """One withdrawal leg as the provider reports it."""

    payout_id: str
    batch_id: str | None
    status: str
    address: str
    currency: str
    amount: float
    hash: str | None
    error: str | None


def configured() -> bool:
    """Whether crypto is switched on at all. Everything user-facing checks this first."""
    return bool(NOWPAYMENTS_API_KEY)


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json"}
    if extra:
        headers.update(extra)
    return headers


async def _call(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """
    One request to the provider, with its own errors turned into ours.

    The provider answers business refusals with HTTP 400 and a `code` field — `AMOUNT_MINIMAL_ERROR`
    being the one that matters most — so the code is carried through rather than flattened into a
    generic failure. A caller can then say "this coin needs more than that" instead of "error".
    """
    if not configured():
        message = "Крипто-оплата не настроена на сервере"
        raise NowPaymentsError(message)
    url = f"{NOWPAYMENTS_API_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=NOWPAYMENTS_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method, url, params=params, json=body, headers=_headers(headers)
            )
    except httpx.HTTPError as exc:
        message = f"Платёжный провайдер недоступен: {exc}"
        raise NowPaymentsError(message) from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if response.status_code >= HTTP_ERROR_FLOOR:
        detail = None
        code = None
        if isinstance(payload, dict):
            detail = payload.get("message") or payload.get("error")
            code = payload.get("code")
        raise NowPaymentsError(
            str(detail or f"Провайдер ответил {response.status_code}"),
            status_code=response.status_code,
            code=str(code) if code else None,
        )
    return payload


async def status() -> bool:
    """A liveness check, used by the health endpoint and by the admin panel."""
    try:
        payload = await _call("GET", "/status")
    except NowPaymentsError:
        return False
    return isinstance(payload, dict) and payload.get("message") == "OK"


async def merchant_coins() -> list[str]:
    """The coins this merchant account has actually switched on, lower-cased."""
    payload = await _call("GET", "/merchant/coins")
    coins = payload.get("selectedCurrencies", []) if isinstance(payload, dict) else []
    return sorted({str(coin).lower() for coin in coins})


async def minimum(currency: str) -> CoinMinimum:
    """The provider's own floor for one coin, with what it is worth in dollars."""
    payload = await _call(
        "GET",
        "/min-amount",
        params={
            "currency_from": currency,
            "currency_to": currency,
            "fiat_equivalent": "usd",
        },
    )
    if not isinstance(payload, dict) or "min_amount" not in payload:
        message = f"Не удалось узнать минимум для {currency}"
        raise NowPaymentsError(message)
    fiat = payload.get("fiat_equivalent")
    return CoinMinimum(
        currency=currency.lower(),
        min_amount=float(payload["min_amount"]),
        fiat_equivalent=float(fiat) if fiat is not None else None,
    )


async def estimate(amount: float, currency_from: str, currency_to: str) -> Estimate:
    """How much `currency_to` the given fiat amount buys right now."""
    payload = await _call(
        "GET",
        "/estimate",
        params={
            "amount": amount,
            "currency_from": currency_from,
            "currency_to": currency_to,
        },
    )
    if not isinstance(payload, dict) or "estimated_amount" not in payload:
        raise NowPaymentsError("Провайдер не вернул расчёт суммы")
    return Estimate(
        currency_from=str(payload.get("currency_from", currency_from)),
        amount_from=float(payload.get("amount_from", amount)),
        currency_to=str(payload.get("currency_to", currency_to)),
        estimated_amount=float(payload["estimated_amount"]),
    )


def _payment_from(payload: Any) -> PaymentRecord:
    if not isinstance(payload, dict) or "payment_id" not in payload:
        raise NowPaymentsError("Провайдер вернул платёж без идентификатора")
    return PaymentRecord(
        payment_id=str(payload["payment_id"]),
        payment_status=str(payload.get("payment_status", "waiting")),
        pay_address=str(payload.get("pay_address", "")),
        pay_amount=float(payload.get("pay_amount") or 0),
        pay_currency=str(payload.get("pay_currency", "")).lower(),
        price_amount=float(payload.get("price_amount") or 0),
        price_currency=str(payload.get("price_currency", "")).lower(),
        order_id=str(payload["order_id"]) if payload.get("order_id") else None,
        actually_paid=float(payload.get("actually_paid") or 0),
        outcome_amount=(
            float(payload["outcome_amount"]) if payload.get("outcome_amount") is not None else None
        ),
        payin_extra_id=(
            str(payload["payin_extra_id"]) if payload.get("payin_extra_id") else None
        ),
        network=str(payload["network"]) if payload.get("network") else None,
        expiration_estimate_date=(
            str(payload["expiration_estimate_date"])
            if payload.get("expiration_estimate_date")
            else None
        ),
    )


async def create_payment(  # noqa: PLR0913 - one named argument per invoice field reads better here
    *,
    price_amount: float,
    price_currency: str,
    pay_currency: str,
    order_id: str,
    order_description: str,
    ipn_callback_url: str | None = None,
) -> PaymentRecord:
    """
    Open a payment and get the address to send to.

    `order_id` is ours and is how the callback is tied back to a row — it carries no secret, so a
    guessed one still cannot credit anything: the credit path re-reads the payment by its provider
    id and checks the amount.
    """
    body: dict[str, Any] = {
        "price_amount": price_amount,
        "price_currency": price_currency,
        "pay_currency": pay_currency,
        "order_id": order_id,
        "order_description": order_description,
        "is_fixed_rate": True,
    }
    if ipn_callback_url:
        body["ipn_callback_url"] = ipn_callback_url
    return _payment_from(await _call("POST", "/payment", body=body))


async def payment(payment_id: str) -> PaymentRecord:
    """Re-read one payment. This — not a callback body — is what a credit is decided on."""
    return _payment_from(await _call("GET", f"/payment/{payment_id}"))


async def validate_address(address: str, currency: str, extra_id: str | None = None) -> str | None:
    """
    Ask the provider whether it would pay to this address at all.

    Returns None when the address is good, or the provider's own complaint when it is not — a
    checksum mistake is a typo somewhere in a wallet address, and telling somebody that before
    their money leaves is the whole point.
    """
    body: dict[str, Any] = {"address": address, "currency": currency}
    if extra_id:
        body["extra_id"] = extra_id
    try:
        await _call("POST", "/payout/validate-address", body=body)
    except NowPaymentsError as exc:
        return str(exc)
    return None


def verify_ipn(raw_body: bytes, signature: str | None) -> bool:
    """
    Whether a callback really came from NOWPayments.

    HMAC-SHA512 over the JSON body with its keys sorted, which is what the provider signs. When no
    IPN secret is configured this returns False and the caller falls back to re-reading the payment
    over the API — the callback is then merely a nudge, and an unsigned nudge is harmless.
    """
    if not NOWPAYMENTS_IPN_SECRET or not signature:
        return False
    try:
        parsed = json.loads(raw_body)
    except ValueError:
        return False
    canonical = json.dumps(parsed, sort_keys=True, separators=(",", ":")).encode()
    digest = hmac.new(
        NOWPAYMENTS_IPN_SECRET.encode(), canonical, hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(digest, signature.strip())


def _payout_from(payload: Any) -> PayoutRecord:
    if not isinstance(payload, dict) or "id" not in payload:
        raise NowPaymentsError("Провайдер вернул выплату без идентификатора")
    return PayoutRecord(
        payout_id=str(payload["id"]),
        batch_id=(
            str(payload["batch_withdrawal_id"]) if payload.get("batch_withdrawal_id") else None
        ),
        status=str(payload.get("status", "CREATING")).lower(),
        address=str(payload.get("address", "")),
        currency=str(payload.get("currency", "")).lower(),
        amount=float(payload.get("amount") or 0),
        hash=str(payload["hash"]) if payload.get("hash") else None,
        error=str(payload["error"]) if payload.get("error") else None,
    )


async def create_payout(  # noqa: PLR0913 - the provider's own withdrawal fields, one per argument
    *,
    address: str,
    currency: str,
    amount: float,
    jwt_token: str,
    extra_id: str | None = None,
    ipn_callback_url: str | None = None,
) -> list[PayoutRecord]:
    """
    Send crypto out.

    Deliberately requires a `jwt_token`: the provider gates real withdrawals behind an
    email/password login on top of the API key, and a 2FA code on top of that. This project does
    **not** hold those credentials, so nothing calls this in production — an approved crypto payout
    is carried out by an admin from their own NOWPayments dashboard and marked paid in ours, with
    the transaction hash recorded. The function exists so that switching to automatic payouts later
    is a configuration change rather than a rewrite.
    """
    body: dict[str, Any] = {
        "withdrawals": [
            {
                "address": address,
                "currency": currency,
                "amount": amount,
                **({"extra_id": extra_id} if extra_id else {}),
            }
        ]
    }
    if ipn_callback_url:
        body["ipn_callback_url"] = ipn_callback_url
    payload = await _call(
        "POST", "/payout", body=body, headers={"Authorization": f"Bearer {jwt_token}"}
    )
    rows = payload.get("withdrawals", []) if isinstance(payload, dict) else []
    return [_payout_from(row) for row in rows]
