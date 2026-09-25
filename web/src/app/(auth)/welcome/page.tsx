import type { Metadata } from "next";

import { WelcomeCarousel } from "@/components/auth/welcome-carousel";

export const metadata: Metadata = { title: "Meet GRAM" };

export default function WelcomePage() {
  return <WelcomeCarousel />;
}
