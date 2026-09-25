"use client";

import { usePathname } from "next/navigation";
import { ComposeDialog } from "./compose-dialog";
import { GiftsDeepLink } from "./gifts/gifts-deep-link";
import { GiftsSheet } from "./gifts/gifts-sheet";
import { LiveNotifications } from "./live-notifications";
import { SiteAppearance } from "./site-appearance";
import { PremiumSheetHost } from "./premium/premium-sheet-host";
import { TopUpSheetHost } from "./stars/top-up-sheet-host";
import { ContextRail } from "./context-rail";
import { DesktopNavigation, MobileComposeButton, MobileDock } from "./navigation";
import { useRouteFade } from "./page-transition";

/**
 * The reference keeps its right rail on browsing surfaces and drops it on profiles and
 * conversations, where the column itself is the whole subject.
 */
const RAILLESS = [/^\/u\//, /^\/profile\//, /^\/chats/, /^\/settings/];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const showRail = !RAILLESS.some((pattern) => pattern.test(pathname));
  /* The fade is a class on the frame itself. Wrapping `children` in another element would put a box
     of auto height between `.channel-frame` and a screen that sizes itself with `height: 100%` —
     which is exactly how the desktop conversation lost its composer and its scroll. */
  const fading = useRouteFade();
  return (
    <div className="app-grid" data-rail={showRail}>
      <aside className="desktop-sidebar"><DesktopNavigation /></aside>
      <main className="main-channel">
        <div className={`channel-frame${fading ? " page-enter" : ""}`}>{children}</div>
      </main>
      {showRail ? <div className="context-rail"><ContextRail /></div> : null}
      <MobileComposeButton />
      <MobileDock />
      <ComposeDialog />
      <PremiumSheetHost />
      <TopUpSheetHost />
      <GiftsSheet />
      <GiftsDeepLink />
      <SiteAppearance />
      <LiveNotifications />
    </div>
  );
}
