import type { Metadata } from "next";
import { AdminView } from "@/components/admin/admin-view";

export const metadata: Metadata = { title: "Administration · GRAM" };

/**
 * `/admin` is not hidden — the panel itself refuses everything to a non-admin, and the server
 * refuses it again on every request. Hiding the route would only mean a staff member cannot
 * bookmark it.
 */
export default function AdminPage() {
  return <AdminView />;
}
