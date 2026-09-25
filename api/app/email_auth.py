"""GRAM email verification and login-code delivery without persisting raw codes."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from html import escape

from app.config import (
    EMAIL_AUTH_ENABLED,
    EMAIL_OTP_BYPASS,
    EMAIL_OTP_SECRET,
    EMAIL_OTP_TTL_MINUTES,
    SITE_PUBLIC_URL,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_SSL,
    SMTP_TLS,
    SMTP_USER,
)


def ensure_email_auth_ready() -> None:
    """Fail closed at startup when production email auth is enabled but incomplete."""
    if not EMAIL_AUTH_ENABLED or EMAIL_OTP_BYPASS:
        return
    missing = [
        name
        for name, value in (
            ("EMAIL_OTP_SECRET", EMAIL_OTP_SECRET),
            ("SMTP_HOST", SMTP_HOST),
            ("SMTP_USER", SMTP_USER),
            ("SMTP_PASSWORD", SMTP_PASSWORD),
            ("SMTP_FROM", SMTP_FROM),
        )
        if not value
    ]
    if missing:
        raise RuntimeError("Email authentication configuration is incomplete: " + ", ".join(missing))
    if len(EMAIL_OTP_SECRET) < 32:
        raise RuntimeError("EMAIL_OTP_SECRET must contain at least 32 characters")


def new_email_code() -> str:
    """Six decimal digits suit email clients' one-time-code recognition."""
    return f"{secrets.randbelow(1_000_000):06d}"


def email_code_hash(challenge_id: uuid.UUID, code: str) -> str:
    """Purpose-bind a code to its challenge with a keyed, constant-time-verifiable digest."""
    if not EMAIL_OTP_SECRET:
        raise RuntimeError("EMAIL_OTP_SECRET is required")
    payload = f"{challenge_id}:{code}".encode("utf-8")
    return hmac.new(EMAIL_OTP_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def email_code_matches(challenge_id: uuid.UUID, code: str, expected: str) -> bool:
    return hmac.compare_digest(email_code_hash(challenge_id, code), expected)


def mask_email(value: str) -> str:
    """Enough context to recognize the mailbox without returning the full private address."""
    local, separator, domain = value.partition("@")
    if not separator:
        return "***"
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'*' * max(3, len(local) - len(visible))}@{domain}"


def _message(code: str, purpose: str) -> EmailMessage:
    registering = purpose == "register"
    action = "подтверждения почты" if registering else "входа в аккаунт"
    title = "Подтвердите почту" if registering else "Подтвердите вход"
    subject = f"Код {action} GRAM"
    text = (
        f"Код для {action} в GRAM: {code}\n\n"
        f"Код действует {EMAIL_OTP_TTL_MINUTES} минут и используется один раз. "
        "Никому его не сообщайте. Если это были не вы — просто проигнорируйте письмо.\n\n"
        f"{SITE_PUBLIC_URL}"
    )
    safe_code = escape(code)
    safe_site = escape(SITE_PUBLIC_URL)
    html = f"""
    <div style="margin:0;padding:32px 16px;background:#050506;color:#f7f6fa;font-family:Inter,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;overflow:hidden;border:1px solid rgba(255,255,255,.10);border-radius:26px;background:#121216;box-shadow:0 24px 70px rgba(0,0,0,.40)">
        <div style="padding:26px 28px 18px;background:linear-gradient(135deg,rgba(109,95,196,.28),rgba(53,35,80,.15))">
          <div style="display:inline-block;padding:9px 12px;border-radius:13px;background:#1b1926;color:#a895ff;font-size:20px;font-weight:900">G</div>
          <div style="margin-top:18px;color:#a895ff;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">GRAM Security</div>
          <h1 style="margin:8px 0 0;color:#fff;font-size:30px;line-height:1.15">{title}</h1>
        </div>
        <div style="padding:24px 28px 28px">
          <p style="margin:0;color:#a6a5ad;font-size:16px;line-height:1.65">Введите этот одноразовый код на сайте GRAM:</p>
          <div style="margin:24px 0;padding:18px;border-radius:18px;background:#1a1921;color:#fff;text-align:center;font-size:40px;font-weight:900;letter-spacing:10px">{safe_code}</div>
          <p style="margin:0;color:#85838e;font-size:14px;line-height:1.6">Код действует {EMAIL_OTP_TTL_MINUTES} минут. Если вы не выполняли это действие, игнорируйте письмо и не передавайте код другим людям.</p>
          <a href="{safe_site}" style="display:inline-block;margin-top:22px;color:#a895ff;font-size:14px;font-weight:800;text-decoration:none">Открыть GRAM →</a>
        </div>
      </div>
    </div>
    """
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = SMTP_FROM
    message["To"] = ""  # Set by send_auth_code so one object never leaks across recipients.
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


def send_auth_code(to_email: str, code: str, *, purpose: str) -> None:
    """Deliver through Mailcow with certificate verification and no secret logging."""
    ensure_email_auth_ready()
    message = _message(code, purpose)
    message.replace_header("To", to_email)
    context = ssl.create_default_context()
    use_ssl = SMTP_SSL or SMTP_PORT == 465
    use_tls = SMTP_TLS and not use_ssl
    if use_ssl:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=15) as smtp:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(message)
        return
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
        smtp.ehlo()
        if use_tls:
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(message)
