import { InboxPage } from "@/components/inbox/inbox-page";

export default function DashboardInboxPage({ searchParams }: { searchParams: { conversationId?: string } }) {
  return <InboxPage initialConversationId={searchParams.conversationId} />;
}
