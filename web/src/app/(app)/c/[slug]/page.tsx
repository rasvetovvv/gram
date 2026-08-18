import { CommunityProfileView } from "@/components/communities/community-profile-view";

export default async function CommunityAliasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunityProfileView slug={slug} />;
}
