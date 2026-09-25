import type { Metadata } from "next";

import { creatorSections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Creator Terms",
  description: "Rules for creators, community owners, subscriptions, Stars and digital goods in GRAM.",
  alternates: { canonical: "/creator-terms" }
};

export default function CreatorTermsPage() {
  return (
    <LegalDocument
      eyebrow="Creator Terms"
      title="Creator Terms"
      description="Content, communities, paid access, Stars, payouts, advertising and responsibility to your audience."
      important="The creator keeps the rights to their work but is responsible for licenses, an honest description of the offer and obligations to the audience."
      current="/creator-terms"
      sections={creatorSections}
    />
  );
}
