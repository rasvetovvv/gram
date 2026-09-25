import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth/auth-gate";

/**
 * Everything in this route group is the signed-in product. A crawler without a session can only see
 * AuthGate's session check, and indexing settings/chats/admin would both leak route names and compete
 * with the public pages that actually answer a search query. `robots.txt` prevents routine crawling;
 * this page-level directive is what makes an already-known URL disappear from a result index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true, nosnippet: true }
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
