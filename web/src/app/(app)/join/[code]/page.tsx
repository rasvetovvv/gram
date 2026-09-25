import type { Metadata } from "next";
import { GroupInviteView } from "@/components/chats/group-invite-view";

export const metadata: Metadata = { title: "Group invitation" };

export default async function GroupInvitePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <GroupInviteView code={decodeURIComponent(code)} />;
}
