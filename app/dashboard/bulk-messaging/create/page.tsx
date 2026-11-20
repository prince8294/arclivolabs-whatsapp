import { CampaignWizard } from "@/components/campaigns/campaign-wizard";
import { PersonalizedCsvWizard } from "@/components/campaigns/personalized-csv-wizard";

export default function CreateCampaignPage({ searchParams }: { searchParams: { campaignId?: string; mode?: string } }) {
  if (searchParams.campaignId) return <CampaignWizard campaignId={searchParams.campaignId} />;
  return <PersonalizedCsvWizard />;
}
