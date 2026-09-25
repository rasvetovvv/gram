import type { Metadata } from "next";

/**
 * Sign-in, sign-up, recovery and onboarding are not answers to anything a searcher asked: they are
 * dead ends in a result list, and an indexed login page competes with the pages that do explain
 * GRAM. `robots.txt` alone cannot remove them — a Disallow only stops the fetch, so a page already
 * known to Google stays listed. This directive is the part that actually drops them.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true }
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
