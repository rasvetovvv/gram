import type { Metadata } from "next";

import { privacySections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What data GRAM processes, why, how it protects them, and what rights users have.",
  alternates: { canonical: "/privacy" }
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      description="A clear description of account data, content, messages, payments, sessions, and support requests."
      important="GRAM does not sell personal data or use it for third-party behavioral advertising."
      current="/privacy"
      sections={privacySections}
    />
  );
}