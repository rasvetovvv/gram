import type { Metadata } from "next";

import { cookieSections } from "@/components/public/legal-content";
import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "The required cookies, localStorage and browser settings that GRAM uses.",
  alternates: { canonical: "/cookies" }
};

export default function CookiesPage() {
  return (
    <LegalDocument
      eyebrow="Cookie Policy"
      title="Cookie Policy"
      description="What data GRAM stores in your browser for sign-in, security and display."
      important="For now, GRAM uses required storage to run the service, not advertising cookies."
      current="/cookies"
      sections={cookieSections}
    />
  );
}
