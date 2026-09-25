import type { Metadata } from "next";

import { termsSections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms of use and access rules for the GRAM social messenger.",
  alternates: { canonical: "/terms" }
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Terms of Use / Terms & Conditions"
      title="Terms of Use"
      description="The rules for accessing GRAM, publishing content, communicating, digital features and moderation."
      important="By creating an account or using GRAM, you agree to comply with these Terms and the related policies."
      current="/terms"
      sections={termsSections}
    />
  );
}
