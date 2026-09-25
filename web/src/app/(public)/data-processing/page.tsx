import type { Metadata } from "next";

import { processingSections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Data Processing Policy",
  description: "Principles, processes, and safeguards for processing personal data in GRAM.",
  alternates: { canonical: "/data-processing" }
};

export default function DataProcessingPage() {
  return (
    <LegalDocument
      eyebrow="Data Processing Policy"
      title="Data Processing Policy"
      description="How GRAM minimizes data, separates access, works with providers, and responds to requests."
      important="Legal requests and login data are kept separate from the public profile and accessible only within the scope of a specific task."
      current="/data-processing"
      sections={processingSections}
    />
  );
}