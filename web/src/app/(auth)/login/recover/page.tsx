import type { Metadata } from "next";

import { AuthPending } from "@/components/auth/auth-pending";

export const metadata: Metadata = { title: "Account recovery" };

export default function RecoverPage() {
  return (
    <AuthPending
      title="Recovery"
      subtitle="Reset your password by email"
      body="Sending a reset link by email isn't wired up yet: GRAM doesn't have an email provider so far. If you've lost access, change your password from an active session in settings — the 'Security' section."
    />
  );
}
