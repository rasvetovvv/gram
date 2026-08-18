import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "GRAM — социальный мессенджер", template: "%s · GRAM" },
  description: "Лента, личные чаты, коллекционные подарки и юзернеймы в одном живом пространстве.",
  applicationName: "GRAM"
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        {/*
        THESIS: GRAM is a rounded identity network where a person, their conversations, communities, usernames, Stars, and collectible history read as one durable social self; it refuses both a fintech dashboard and a livestream metaphor.
        OWN-WORLD: an almost-black social canvas, open profile layers, graphite grouped surfaces, capsule navigation, violet actions, cyan identity links, gold Stars, green presence, and colorful collectibles contained inside their own rarity worlds.
        STORY: register, shape an identity, discover people, publish or talk, subscribe, then collect and place an owned object directly into the profile.
        FIRST VIEWPORT: mobile reveals an edge-to-edge cover, overlapping avatar and identity actions above a floating five-destination dock; desktop keeps a quiet rail, a 720–780px social column, and an optional context rail.
        FORM: grounded direction six, rounded social canvas; the user's fifty-two Telegram-like product references pin the interaction grammar over challenger worlds; seed 3c690579.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
