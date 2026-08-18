import type { Metadata } from "next";

import { AuthPending } from "@/components/auth/auth-pending";

export const metadata: Metadata = { title: "Вход по QR-коду" };

export default function QrLoginPage() {
  return (
    <AuthPending
      title="Вход по QR-коду"
      subtitle="Подтверждение с уже открытого устройства"
      body="Экран есть, но подтверждать код пока нечему: у GRAM нет мобильного приложения, которое могло бы его сканировать. Пока входите почтой или юзернеймом — сессия так же держится 30 дней."
    />
  );
}
