import { GiftsView } from "@/components/gifts/gifts-view";

export default async function GiftsPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  // `?to=` arrives from the "Отправить подарок" action in a profile header.
  const recipient = to ? to.trim().replace(/^@+/, "").toLowerCase() : undefined;
  return <GiftsView recipient={recipient || undefined} />;
}
