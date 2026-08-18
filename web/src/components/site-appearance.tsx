"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyPrefs,
  getPrefsSnapshot,
  getServerPrefsSnapshot,
  subscribePrefs
} from "@/lib/site-prefs";

/**
 * Applies the stored appearance and keeps every open tab in step.
 *
 * The attributes go on `<html>`, so the choice survives navigation without each screen having
 * to know about it.
 */
export function SiteAppearance() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getServerPrefsSnapshot);

  useEffect(() => {
    applyPrefs(prefs);
  }, [prefs]);

  return null;
}
