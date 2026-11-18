import { CampaignAnalyticsPage } from "@/components/analytics/campaign-analytics-page";

export default function DashboardCampaignAnalyticsPage({ params }: { params: { id: string } }) {
  return <CampaignAnalyticsPage campaignId={params.id} />;
}
