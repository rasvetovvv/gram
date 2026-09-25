"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Whether the route changed just now, for a short cross-fade between screens.
 *
 * Returns a flag rather than rendering a wrapper, and that is the whole point of the design. An
 * earlier version wrapped `children` in its own `<div>`, which broke the conversation on desktop:
 * the chat pane is sized with `height: 100%` against `.channel-frame`, and an extra element in
 * between has auto height, so the pane collapsed — no composer, nothing scrollable. A hook that
 * hands back a class name cannot change the layout, because it adds nothing to the tree.
 *
 * The fade is opacity only for a related reason: a `transform` on an ancestor makes every
 * `position: fixed` descendant position itself against that ancestor instead of the viewport, which
 * would break the chat pane, the media viewer and every sheet at once.
 *
 * Nothing re-mounts either — remounting a route would throw away scroll position and re-run every
 * query on the way back.
 */
export function useRouteFade(): boolean {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    setEntering(true);
    // Just longer than the animation, so the class is gone before the next navigation needs it.
    const done = setTimeout(() => setEntering(false), 260);
    return () => clearTimeout(done);
  }, [pathname]);

  return entering;
}
