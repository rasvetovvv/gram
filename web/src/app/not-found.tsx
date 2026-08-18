import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center p-6 text-center"><div><Compass size={38} className="mx-auto text-[var(--primary-strong)]" /><h1 className="display-font mt-6 text-2xl">Страница не найдена</h1><p className="text-[var(--muted)]">Адрес изменился или этого раздела больше нет.</p><Link href="/" className="signal-button mt-4">Вернуться в ленту</Link></div></main>;
}
