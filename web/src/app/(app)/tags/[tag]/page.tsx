import type { Metadata } from "next";
import { HashtagView } from "@/components/discover/hashtag-view";

function canonical(tag: string) {
  return decodeURIComponent(tag).trim().replace(/^#+/, "").toLowerCase();
}

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${canonical(tag)}` };
}

export default async function HashtagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return <HashtagView tag={canonical(tag)} />;
}
