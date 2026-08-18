import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileView } from "@/components/profile/profile-view";

function canonical(username: string) {
  return decodeURIComponent(username).trim().replace(/^@+/, "").toLowerCase();
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${canonical(username)}` };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const handle = canonical(username);
  if (!handle) redirect("/discover");
  // `@handle` and mixed casing are valid inbound links, but only one URL should render.
  if (handle !== decodeURIComponent(username)) redirect(`/u/${encodeURIComponent(handle)}`);
  return <ProfileView username={handle} />;
}
