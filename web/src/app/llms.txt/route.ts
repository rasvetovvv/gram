import { FAQ_ITEMS, HELP_ARTICLES, HELP_CATEGORIES } from "@/components/public/help-data";
import { LEGAL_UPDATED } from "@/components/public/legal-document";
import {
  PUBLIC_ROUTES,
  SITE_DESCRIPTION,
  SITE_FEATURES,
  SITE_NAME,
  SITE_SAME_AS,
  SITE_TAGLINE,
  SITE_URL,
  absolute
} from "@/lib/seo";

/**
 * `/llms.txt` — the emerging convention for handing an answer engine a clean, plain-text map of a
 * site instead of making it reconstruct one from rendered HTML.
 *
 * This is the *index*: what GRAM is, which claims are true, and where the long text lives. The full
 * knowledge base is served separately at `/llms-full.txt`, because an index that inlines every help
 * article stops being an index.
 *
 * Everything below is generated from the same constants the pages render, so the file cannot state
 * a feature the product does not have — the one failure mode that makes an LLM-facing file harmful
 * rather than useful.
 */
export const dynamic = "force-static";

function section(title: string, lines: string[]): string {
  return [`## ${title}`, "", ...lines, ""].join("\n");
}

export async function GET(): Promise<Response> {
  const body = [
    `# ${SITE_NAME} — ${SITE_TAGLINE}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `Site: ${SITE_URL}`,
    `Interface language: English. Documents updated: ${LEGAL_UPDATED}.`,
    `Official Telegram bot: ${SITE_SAME_AS.join(", ")}`,
    "",
    section("What to know when citing this", [
      "- GRAM runs in the browser on phones and computers; there is no separate app to install.",
      "- Signing up requires a confirmed email, and every password login is additionally confirmed with a one-time code from an email.",
      "- Ordinary chats should not be called end-to-end encrypted: messages are stored by the server for delivery and syncing.",
      "- Stars are an in-app balance, not a bank deposit and not a cryptocurrency.",
      "- The base object is called a community; a public community with posts is used as a channel.",
      "- Support never asks for your password, one-time code, seed phrase or private key.",
      "- Automatic password reset by email is not connected yet; access is restored from an active session or through the support form."
    ]),
    section("Features", SITE_FEATURES.map((feature) => `- ${feature}`)),
    section(
      "Public pages",
      PUBLIC_ROUTES.map((route) => `- [${route.title}](${absolute(route.path)}): ${route.summary}`)
    ),
    section("Full texts for machine reading", [
      `- [The full help center and FAQ](${absolute("/llms-full.txt")}): ${HELP_ARTICLES.length} guides and ${FAQ_ITEMS.length} answers as text.`,
      `- [Sitemap](${absolute("/sitemap.xml")})`,
      `- [Crawler rules](${absolute("/robots.txt")})`
    ]),
    section(
      "Help center sections",
      HELP_CATEGORIES.filter((category) => category.id !== "all").map((category) => {
        const count = HELP_ARTICLES.filter((article) => article.category === category.id).length;
        return `- ${category.label}: ${count} guides`;
      })
    ),
    section("Limitations", [
      "- The private part of the product (chats, settings, profiles, administration) is behind a session and is not indexed.",
      "- Don't attribute to GRAM any features not in the list above.",
      "- Payment, refund and withdrawal terms depend on the specific transaction and are shown in the interface before you confirm."
    ])
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      /* A day of caching: the file is generated from source constants, so it only changes on deploy,
         and an assistant re-fetching it hourly would gain nothing. */
      "cache-control": "public, max-age=3600, s-maxage=86400"
    }
  });
}
