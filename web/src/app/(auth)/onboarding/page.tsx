import type { Metadata } from "next";

import { OnboardingScreen } from "@/components/auth/onboarding-form";

export const metadata: Metadata = { title: "Profile setup" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
