import type { Metadata } from "next";

import { AuthPending } from "@/components/auth/auth-pending";

export const metadata: Metadata = { title: "Восстановление доступа" };

export default function RecoverPage() {
  return (
    <AuthPending
      title="Восстановление"
      subtitle="Сброс пароля по почте"
      body="Отправка письма со ссылкой ещё не подключена: у GRAM пока нет почтового провайдера. Если доступ потерян, смените пароль из активной сессии в настройках — раздел «Безопасность»."
    />
  );
}
