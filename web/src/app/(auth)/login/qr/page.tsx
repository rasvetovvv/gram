import type { Metadata } from "next";

import { AuthPending } from "@/components/auth/auth-pending";

export const metadata: Metadata = { title: "Sign in with QR code" };

export default function QrLoginPage() {
  return (
    <AuthPending
      title="Sign in with QR code"
      subtitle="Confirm from a device you're already signed in on"
      body="The screen is here, but there's nothing to confirm the code with yet: GRAM has no mobile app that could scan it. For now, sign in with your email or username — the session still lasts 30 days."
    />
  );
}