import { Queue } from "bullmq";
import IORedis from "ioredis";

export const CAMPAIGN_QUEUE_NAME = "arclivo-whatsapp-campaigns";
export const WORKER_HEARTBEAT_KEY = `${CAMPAIGN_QUEUE_NAME}:worker-heartbeat`;
const WORKER_HEARTBEAT_TTL_SECONDS = 45;

declare global {
  // eslint-disable-next-line no-var
  var campaignQueueInstance: Queue | undefined;
  // eslint-disable-next-line no-var
  var campaignRedisInstance: IORedis | undefined;
}

export function normalizedRedisUrl(value = process.env.REDIS_URL) {
  const configured = value?.trim();
  if (!configured) throw new Error("REDIS_URL is not configured.");

  // Upstash's console also shows a ready-to-run `redis-cli --tls -u ...`
  // command. Accept the URL inside that command so a harmless paste mistake
  // cannot strand an already-created campaign, while still validating it.
  const commandUrl = configured.match(/(?:^|\s)-u\s+["']?(rediss?:\/\/[^\s"']+)["']?(?:\s|$)/i)?.[1];
  const redisUrl = commandUrl ?? configured;
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error("REDIS_URL must be a redis:// or rediss:// connection URL, not a shell command.");
  }
  if (!["redis:", "rediss:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) {
    throw new Error("REDIS_URL must include a redis:// or rediss:// host and port.");
  }
  if (parsed.hostname.endsWith(".upstash.io") && parsed.protocol !== "rediss:") {
    parsed.protocol = "rediss:";
  }
  return parsed.toString();
}

export function createRedisConnection() {
  return new IORedis(normalizedRedisUrl(), {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    enableReadyCheck: true,
    retryStrategy: (times) => times > 4 ? null : Math.min(times * 500, 2000)
  });
}

export async function verifyQueueInfrastructure(requireWorker = true) {
  const connection = createRedisConnection();
  try {
    await connection.ping();
    const heartbeat = await connection.get(WORKER_HEARTBEAT_KEY);
    if (requireWorker && !heartbeat) {
      throw new Error("The campaign worker is not reporting a current heartbeat.");
    }
    return { redis: true, worker: requireWorker ? true : Boolean(heartbeat) };
  } finally {
    await connection.quit().catch(() => connection.disconnect());
  }
}

export async function writeWorkerHeartbeat(connection: IORedis) {
  await connection.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
}

export function getCampaignQueue() {
  if (!global.campaignRedisInstance) {
    global.campaignRedisInstance = createRedisConnection();
    global.campaignRedisInstance.on("error", (error) =>
      console.error("Campaign Redis connection error.", error.message)
    );
  }
  if (!global.campaignQueueInstance) {
    global.campaignQueueInstance = new Queue(CAMPAIGN_QUEUE_NAME, { connection: global.campaignRedisInstance });
    global.campaignQueueInstance.on("error", (error) =>
      console.error("Campaign queue error.", error.message)
    );
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
