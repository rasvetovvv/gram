import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { Providers } from "@/components/providers";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  applicationSchema,
  organizationSchema,
  websiteSchema
} from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "social networking",
  alternates: { canonical: "/" },
  /* An answer engine reads the same tags a search engine does, so `googleBot` gets the long
     snippet limits explicitly: the defaults truncate exactly the sentences that describe GRAM. */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION
  },
  formatDetection: { telephone: false, email: false, address: false }
};

/**
 * `interactiveWidget: "resizes-content"` is the whole reason the chat behaves on a phone.
 *
 * By default the on-screen keyboard *overlays* the viewport: the layout keeps its full height,
 * the browser scrolls the page to reveal the field, and the header slides away while the composer
 * ends up somewhere unpredictable — which is the "the page zooms in" complaint. Asking the
 * browser to resize the content instead means `100dvh` shrinks to the space above the keyboard,
 * so the thread and the composer stay exactly where they belong.
 *
 * `maximumScale` is deliberately left alone: pinch-zoom is an accessibility feature, and the
 * unwanted auto-zoom is fixed properly in `globals.css` by giving every field a 16px font on
 * small screens, which is the size iOS stops zooming at.
 */
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/*
        THESIS: GRAM is a rounded identity network where a person, their conversations, communities, usernames, Stars, and collectible history read as one durable social self; it refuses both a fintech dashboard and a livestream metaphor.
        OWN-WORLD: an almost-black social canvas, open profile layers, graphite grouped surfaces, capsule navigation, violet actions, cyan identity links, gold Stars, green presence, and colorful collectibles contained inside their own rarity worlds.
        STORY: register, shape an identity, discover people, publish or talk, subscribe, then collect and place an owned object directly into the profile.
        FIRST VIEWPORT: mobile reveals an edge-to-edge cover, overlapping avatar and identity actions above a floating five-destination dock; desktop keeps a quiet rail, a 720–780px social column, and an optional context rail.
        FORM: grounded direction six, rounded social canvas; the user's fifty-two Telegram-like product references pin the interaction grammar over challenger worlds; seed 3c690579.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {/* Site-wide identity for crawlers and answer engines. Per-page nodes (FAQPage, HowTo,
            ContactPage, breadcrumbs) reference these by @id instead of repeating them. */}
        <JsonLd nodes={[organizationSchema(), websiteSchema(), applicationSchema()]} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
