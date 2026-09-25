import type { Metadata } from "next";

import { communitySections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Community guidelines",
  description: "Rules on safety, acceptable content and conduct in the GRAM community.",
  alternates: { canonical: "/community-guidelines" }
};

export default function CommunityGuidelinesPage() {
  return (
    <LegalDocument
      eyebrow="Community Guidelines"
      title="Community guidelines"
      description="Unified standards for profiles, posts, chats, communities, creators and digital operations."
      important="People's safety matters more than reach: threats, child exploitation, doxxing and fraud can lead to immediate action."
      current="/community-guidelines"
      sections={communitySections}
    />
  );
}
