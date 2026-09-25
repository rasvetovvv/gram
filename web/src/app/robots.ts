import type { MetadataRoute } from "next";

import { PUBLIC_ROUTES, SITE_URL } from "@/lib/seo";

/**
 * Public routes are opened to everyone, including AI crawlers — GRAM's own documentation is what an
 * answer engine should be quoting when someone asks about the service.
 *
 * The signed-in product is closed instead: `/chats`, `/settings`, `/admin` and friends need a
 * session, so a crawler would only ever index the session-check screen, and the API is never a page.
 * Google's own `noindex` handling still needs the page-level directive (a robots.txt Disallow only
 * stops the fetch), which the app routes carry in their metadata.
 */
const PUBLIC_PATHS = [
  ...PUBLIC_ROUTES.map((route) => route.path),
  "/llms.txt",
  "/llms-full.txt"
];

const PRIVATE_PATHS = [
  "/public-home",
  "/api/",
  "/media/",
  "/admin",
  "/chats",
  "/settings",
  "/notifications",
  "/saved",
  "/studio",
  "/stars",
  "/contacts",
  "/onboarding",
  "/login",
  "/register",
  "/welcome",
  "/join/",
  "/u/",
  "/profile/"
];

/* Answer-engine crawlers, named explicitly so an operator can see the intent rather than infer it
   from a wildcard: documentation is fair game, the signed-in product is not. */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "DuckAssistBot",
  "cohere-ai",
  "MistralAI-User",
  "meta-externalagent",
  "YandexBot"
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: PUBLIC_PATHS, disallow: PRIVATE_PATHS },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: PUBLIC_PATHS, disallow: PRIVATE_PATHS }))
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
