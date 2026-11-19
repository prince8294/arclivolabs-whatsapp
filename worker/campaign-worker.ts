import "dotenv/config";
import { Worker } from "bullmq";
import { connectToDatabase } from "@/lib/db/mongodb";
import { CAMPAIGN_QUEUE_NAME, createRedisConnection, writeWorkerHeartbeat } from "@/lib/campaigns/queue";
import { processCampaignJob, recoverQueuedWork } from "@/lib/campaigns/worker";

async function startWorker() {
  const connection = createRedisConnection();
  await connectToDatabase();
  const worker = new Worker(CAMPAIGN_QUEUE_NAME, processCampaignJob, {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 1000 },
    lockDuration: 60_000
  });
  await worker.waitUntilReady();
  await writeWorkerHeartbeat(connection);
  worker.on("failed", (job, error) => {
    console.error("WhatsApp campaign job failed.", { jobId: job?.id, name: job?.name, error });
  });
  worker.on("error", (error) => console.error("WhatsApp campaign worker error.", error));
  await recoverQueuedWork();
  const heartbeatTimer = setInterval(() => {
    void writeWorkerHeartbeat(connection).catch((error: unknown) =>
      console.error("Campaign worker heartbeat failed.", error instanceof Error ? error.message : "Unknown Redis error")
    );
  }, 10_000);
  const reconcileTimer = setInterval(() => {
    void recoverQueuedWork().catch((error: unknown) => console.error("Campaign queue recovery failed.", error));
  }, 30_000);
  const close = async () => {
    clearInterval(heartbeatTimer);
    clearInterval(reconcileTimer);
    await worker.close();
    await connection.quit();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  console.log("WhatsApp campaign worker is running.");
}

startWorker().catch((error: unknown) => {
  console.error("WhatsApp campaign worker could not start.", error);
  process.exitCode = 1;
});
