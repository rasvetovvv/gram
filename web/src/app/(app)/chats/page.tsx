import { Suspense } from "react";
import { ChatView } from "@/components/chats/chat-view";

export default function ChatsPage() {
  return <Suspense fallback={<div className="empty-state">Открываем линию связи…</div>}><ChatView /></Suspense>;
}
