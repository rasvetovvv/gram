import { redirect } from "next/navigation";

/** Legacy profile URL kept working: `/u/[username]` is the canonical profile route. */
export default async function LegacyProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  redirect(`/u/${encodeURIComponent(decodeURIComponent(username).trim().replace(/^@+/, "").toLowerCase())}`);
}
