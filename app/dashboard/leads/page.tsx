import { LeadsPage } from "@/components/leads/leads-page";

export default function DashboardLeadsPage({ searchParams }: { searchParams: { leadId?: string } }) {
  return <LeadsPage initialLeadId={searchParams.leadId} />;
}
