import type { Metadata } from "next";

import { SavedPostsView } from "@/components/saved/saved-posts-view";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return <SavedPostsView />;
}
