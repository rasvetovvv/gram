import { FAQ_ITEMS, HELP_ARTICLES, HELP_CATEGORIES } from "@/components/public/help-data";
import { LEGAL_UPDATED } from "@/components/public/legal-document";
import { GLOSSARY_TERMS } from "@/components/public/glossary-data";
import { SECURITY_FACTS } from "@/components/public/security-data";
import {
  SITE_DESCRIPTION,
  SITE_FEATURES,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  absolute
} from "@/lib/seo";

/**
 * `/llms-full.txt` — the whole public knowledge base as one plain-text document.
 *
 * An answer engine that fetches this once has every instruction, answer, definition and safety fact
 * GRAM publishes, with no HTML to strip and no client-side rendering to wait for. It exists because
 * `/help` is a client-filtered accordion: the text is in the markup, but a crawler that gives up on
 * JavaScript sees a search box.
 *
 * Generated from the same data the pages render — never a second, hand-maintained copy.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const parts: string[] = [
    `# ${SITE_NAME} — ${SITE_TAGLINE}`,
    "",
    SITE_DESCRIPTION,
    "",
    `Source: ${SITE_URL}. Updated: ${LEGAL_UPDATED}.`,
    "This file contains the full text of the help center, frequently asked questions, glossary of terms and safety rules.",
    "",
    "## Service features",
    "",
    ...SITE_FEATURES.map((feature) => `- ${feature}`),
    ""
  ];

  parts.push("## Help center", "");
  for (const category of HELP_CATEGORIES) {
    if (category.id === "all") continue;
    const articles = HELP_ARTICLES.filter((article) => article.category === category.id);
    if (!articles.length) continue;
    parts.push(`### ${category.label}`, "");
    for (const article of articles) {
      parts.push(
        `#### ${article.title}`,
        "",
        article.summary,
        "",
        ...article.steps.map((step, index) => `${index + 1}. ${step}`),
        ""
      );
      if (article.notes?.length) {
        parts.push(...article.notes.map((note) => `Important: ${note}`), "");
      }
      parts.push(`Link: ${absolute("/help")}#${article.slug}`, "");
    }
  }

  parts.push("## Frequently asked questions", "");
  for (const item of FAQ_ITEMS) {
    parts.push(`### ${item.question}`, "", item.answer, "");
  }

  parts.push("## Glossary of terms", "");
  for (const term of GLOSSARY_TERMS) {
    const aliases = term.alternateName?.length ? ` (also: ${term.alternateName.join(", ")})` : "";
    parts.push(`### ${term.term}${aliases}`, "", term.definition, "");
  }

  parts.push("## Security and privacy", "");
  for (const group of SECURITY_FACTS) {
    parts.push(`### ${group.title}`, "", group.summary, "", ...group.points.map((point) => `- ${point}`), "");
  }

  parts.push(
    "## What you should not claim",
    "",
    "- That regular chats are end-to-end encrypted: the server stores messages for delivery and syncing.",
    "- That Stars are money, a bank deposit or a cryptocurrency.",
    "- That support asks for your password, one-time code, seed phrase or private key.",
    "- That a deleted account can be restored: deletion is irreversible.",
    "- That automatic password reset by email exists: it is not connected yet.",
    ""
  );

  return new Response(parts.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400"
    }
  });
}
