import { Queue } from "bullmq";
import IORedis from "ioredis";

export const CAMPAIGN_QUEUE_NAME = "arclivo-whatsapp-campaigns";

declare global {
  // eslint-disable-next-line no-var
  var campaignQueueInstance: Queue | undefined;
  // eslint-disable-next-line no-var
  var campaignRedisInstance: IORedis | undefined;
}

export function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is not configured.");
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    retryStrategy: (times) => times > 4 ? null : Math.min(times * 500, 2000)
  });
}

export function getCampaignQueue() {
  if (!global.campaignRedisInstance) global.campaignRedisInstance = createRedisConnection();
  if (!global.campaignQueueInstance) {
    global.campaignQueueInstance = new Queue(CAMPAIGN_QUEUE_NAME, { connection: global.campaignRedisInstance });
  }
  return global.campaignQueueInstance;
}

export function sendJobId(recipientId: string, version: number) {
  return `recipient-${recipientId}-v${version}`;
}

export async function enqueueCampaignDispatch(campaignId: string, version: number) {
  const queue = getCampaignQueue();
  const jobId = `dispatch-${campaignId}-v${version}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") await existing.retry("failed");
    return;
  }
  await queue.add("dispatch-campaign", { campaignId }, {
    jobId,
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function enqueueRecipient(campaignId: string, recipientId: string, version: number) {
  await getCampaignQueue().add(
    "send-recipient",
    { campaignId, recipientId },
    {
      jobId: sendJobId(recipientId, version),
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  );
}

export async function enqueueRecipients(
  recipients: { campaignId: string; recipientId: string; version: number }[]
) {
  if (!recipients.length) return;
  await getCampaignQueue().addBulk(recipients.map(({ campaignId, recipientId, version }) => ({
    name: "send-recipient",
    data: { campaignId, recipientId },
    opts: {
      jobId: sendJobId(recipientId, version),
      attempts: 5,
      backoff: { type: "exponential" as const, delay: 3000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  })));
}
