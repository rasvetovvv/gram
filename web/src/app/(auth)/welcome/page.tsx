import type { Metadata } from "next";

import { WelcomeCarousel } from "@/components/auth/welcome-carousel";

export const metadata: Metadata = { title: "Знакомство с GRAM" };

export default function WelcomePage() {
  return <WelcomeCarousel />;
}
