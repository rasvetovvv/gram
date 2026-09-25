import { GiftDetailView } from "@/components/gifts/gift-detail-view";

export default async function GiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GiftDetailView id={id} />;
}
