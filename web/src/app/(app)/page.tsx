import { FeedView } from "@/components/feed/feed-view";

/**
 * `/` is selected by an auth cookie in `proxy.ts`. Never place its signed-in or anonymous result in
 * a shared cache: without `Vary: Cookie`, a CDN could otherwise serve one visitor's branch to the
 * other. The page contains no server data itself, but its representation is request-dependent.
 */
export const dynamic = "force-dynamic";

export default function FeedPage() {
  return <FeedView />;
}
