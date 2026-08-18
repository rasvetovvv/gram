import { StarsWalletView } from "@/components/stars/stars-wallet-view";

export default async function StarsPage({
  searchParams
}: {
  searchParams: Promise<{ to?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawRecipient = Array.isArray(params.to) ? params.to[0] : params.to;
  const initialRecipient = rawRecipient?.trim().replace(/^@/, "").slice(0, 32) ?? "";
  return <StarsWalletView initialRecipient={initialRecipient} />;
}
