import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center p-6 text-center"><div><Compass size={38} className="mx-auto text-[var(--primary-strong)]" /><h1 className="display-font mt-6 text-2xl">Page not found</h1><p className="text-[var(--muted)]">The address changed, or this section no longer exists.</p><Link href="/" className="signal-button mt-4">Back to the feed</Link></div></main>;
}
