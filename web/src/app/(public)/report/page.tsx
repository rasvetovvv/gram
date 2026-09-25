import type { Metadata } from "next";

import { ReportForm } from "@/components/public/report-form";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema, webPageSchema } from "@/lib/seo";
import type { LegalReportKind } from "@/lib/types";

export const metadata: Metadata = {
  title: "Report or request — DMCA, copyright, privacy",
  description:
    "GRAM's form for rights holders and users: a copyright infringement complaint (DMCA), trademark, " +
    "privacy, illegal content, impersonation, harassment, fraud, account access, and technical support.",
  alternates: { canonical: "/report" },
  openGraph: {
    type: "website",
    url: "/report",
    title: "Report or request to GRAM",
    description: "A single form for DMCA, copyright, privacy, safety, and support."
  }
};

const KINDS = new Set<LegalReportKind>([
  "copyright",
  "trademark",
  "privacy",
  "illegal_content",
  "impersonation",
  "abuse",
  "fraud_spam",
  "account_access",
  "technical",
  "other"
]);

export default async function ReportPage({
  searchParams
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.type) ? params.type[0] : params.type;
  const initialKind = raw && KINDS.has(raw as LegalReportKind)
    ? (raw as LegalReportKind)
    : "copyright";

  return (
    <>
      <JsonLd
        nodes={[
          webPageSchema({
            path: "/report",
            name: "Report or request to GRAM",
            description: metadata.description as string,
            type: "ContactPage"
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Report or request", path: "/report" }
          ])
        ]}
      />
      <header className={styles.hero}>
        <p className={styles.eyebrow}>DMCA / Copyright / Report Form</p>
        <h1>Report or request</h1>
        <p className={styles.heroLead}>
          A single form for rights holders, users, privacy questions, account access, and
          technical issues. For an ordinary report about a post, you can also use the post&apos;s own
          menu.
        </p>
      </header>
      <ReportForm initialKind={initialKind} />
    </>
  );
}
