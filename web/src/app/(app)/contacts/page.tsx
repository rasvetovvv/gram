import type { Metadata } from "next";

import { ContactsView } from "@/components/contacts/contacts-view";

export const metadata: Metadata = { title: "Контакты" };

export default function ContactsPage() {
  return <ContactsView />;
}
