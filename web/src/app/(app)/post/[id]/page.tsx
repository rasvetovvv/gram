import { PostDetailView } from "@/components/feed/post-detail-view";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetailView id={id} />;
}
