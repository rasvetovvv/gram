"use client";

import { usePathname } from "next/navigation";
import { ComposeDialog } from "./compose-dialog";
import { GiftsSheet } from "./gifts/gifts-sheet";
import { LiveNotifications } from "./live-notifications";
import { SiteAppearance } from "./site-appearance";
import { PremiumSheetHost } from "./premium/premium-sheet-host";
import { ContextRail } from "./context-rail";
import { DesktopNavigation, MobileComposeButton, MobileDock } from "./navigation";

/**
 * The reference keeps its right rail on browsing surfaces and drops it on profiles and
 * conversations, where the column itself is the whole subject.
 */
const RAILLESS = [/^\/u\//, /^\/profile\//, /^\/chats/, /^\/settings/];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const showRail = !RAILLESS.some((pattern) => pattern.test(pathname));
  return (
    <div className="app-grid" data-rail={showRail}>
      <aside className="desktop-sidebar"><DesktopNavigation /></aside>
      <main className="main-channel"><div className="channel-frame">{children}</div></main>
      {showRail ? <div className="context-rail"><ContextRail /></div> : null}
      <MobileComposeButton />
      <MobileDock />
      <ComposeDialog />
      <PremiumSheetHost />
      <GiftsSheet />
      <SiteAppearance />
      <LiveNotifications />
    </div>
  );
}
