import type { Metadata } from "next";

import { SiteSettingsView } from "@/components/settings/site-settings-view";

export const metadata: Metadata = { title: "Site settings" };

export default function SiteSettingsPage() {
  return <SiteSettingsView />;
}