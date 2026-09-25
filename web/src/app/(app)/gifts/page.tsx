import { redirect } from "next/navigation";

/**
 * `/gifts` is a link people share, not a screen.
 *
 * The collection is a sheet over whatever the reader is looking at — a separate page unmounted
 * the feed behind it, which read as the screen jumping. So the route hands off to the feed with
 * a flag the shell picks up, and the sheet opens there.
 */
export default async function GiftsPage({
  searchParams
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { to } = await searchParams;
  // `?to=` arrives from "Send a gift" in a profile header.
  const recipient = to ? to.trim().replace(/^@+/, "").toLowerCase() : "";
  redirect(recipient ? `/?gifts=1&to=${encodeURIComponent(recipient)}` : "/?gifts=1");
}
