import { CampaignDetails } from "@/components/campaigns/campaign-details";

export default function CampaignDetailsPage({ params }: { params: { id: string } }) {
  return <CampaignDetails campaignId={params.id} />;
}
