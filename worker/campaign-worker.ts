import "dotenv/config";
import { createServer, type Server } from "node:http";
import { Worker } from "bullmq";
import { connectToDatabase } from "@/lib/db/mongodb";
import {
  CAMPAIGN_QUEUE_NAME,
  closeCampaignQueue,
  createRedisConnection,
  getCampaignQueue,
  WORKER_HEARTBEAT_TTL_SECONDS,
  writeWorkerHeartbeat
} from "@/lib/campaigns/queue";
import { processCampaignJob, recoverQueuedWork } from "@/lib/campaigns/worker";
import { getEffectiveCredentials } from "@/lib/whatsapp/config";

// BullMQ's idle long-poll and worker maintenance commands count against managed
// Redis request quotas. These intervals keep an idle worker well below common
// entry-tier limits without delaying an actual queued job notification.
const HEARTBEAT_INTERVAL_MS = 60_000;
const RECOVERY_INTERVAL_MS = 5 * 60_000;
const HEALTH_PORT = 1234;

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { message: "Unknown error" };
  return {
    name: error.name,
    message: error.message.replace(/(?:rediss?|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi, "[redacted connection URL]")
  };
}

function startLivenessServer(worker: Worker, isReady: () => boolean): Promise<Server> {
  const server = createServer((request, response) => {
    const healthy = request.method === "GET" && request.url === "/health" && isReady() && worker.isRunning();
    response.writeHead(healthy ? 200 : request.method === "GET" && request.url === "/health" ? 503 : 404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(healthy ? "ok" : "unhealthy");
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(HEALTH_PORT, "0.0.0.0");
  });
}

async function closeLivenessServer(server: Server | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function startWorker() {
  const missingEnvironment = ["MONGODB_URI", "REDIS_URL", "META_CREDENTIALS_ENCRYPTION_KEY"]
    .filter((name) => !process.env[name]?.trim());
  if (missingEnvironment.length) {
    throw new Error(`Missing required worker environment variables: ${missingEnvironment.join(", ")}.`);
  }

  const connection = createRedisConnection();
  let database: Awaited<ReturnType<typeof connectToDatabase>> | undefined;
  let worker: Worker | undefined;
  let server: Server | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  let recoveryPromise: Promise<void> | undefined;
  let lastHeartbeatAt = 0;
  let isShuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string) => {
    if (shutdownPromise) return shutdownPromise;
    isShuttingDown = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (recoveryTimer) clearInterval(recoveryTimer);

    shutdownPromise = (async () => {
      console.info("Campaign worker shutdown requested.", { signal });
      if (recoveryPromise) {
        try {
          await recoveryPromise;
        } catch (error) {
          console.error("Campaign queue recovery did not finish cleanly.", describeError(error));
        }
      }
      try {
        await closeLivenessServer(server);
      } catch (error) {
        console.error("Campaign worker liveness server shutdown failed.", describeError(error));
        process.exitCode = 1;
      }
      try {
        await worker?.close();
      } catch (error) {
        console.error("BullMQ worker shutdown failed.", describeError(error));
        process.exitCode = 1;
      }
      try {
        await closeCampaignQueue();
      } catch (error) {
        console.error("Campaign queue shutdown failed.", describeError(error));
        process.exitCode = 1;
      }
      try {
        if (connection.status !== "end") await connection.quit();
      } catch (error) {
        console.error("Campaign Redis shutdown failed; disconnecting.", describeError(error));
        connection.disconnect();
        process.exitCode = 1;
      }
      try {
        await database?.disconnect();
      } catch (error) {
        console.error("MongoDB shutdown failed.", describeError(error));
        process.exitCode = 1;
      }
      console.info("Campaign worker shutdown complete.");
    })();

    return shutdownPromise;
  };

  const onSigint = () => {
    void shutdown("SIGINT");
  };
  const onSigterm = () => {
    void shutdown("SIGTERM");
  };

  try {
    await connection.ping();
    console.info("Campaign worker startup: Redis is reachable.");

    database = await connectToDatabase();
    const databaseHandle = database.connection.db;
    if (!databaseHandle) throw new Error("MongoDB connected without an active database handle.");
    await databaseHandle.admin().ping();
    console.info("Campaign worker startup: MongoDB is reachable.");

    await getEffectiveCredentials();
    console.info("Campaign worker startup: Meta credentials are configured.");

    worker = new Worker(CAMPAIGN_QUEUE_NAME, processCampaignJob, {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 1000 },
      lockDuration: 60_000,
      drainDelay: 60,
      stalledInterval: 120_000
    });
    worker.on("failed", (job, error) => {
      console.error("WhatsApp campaign job failed.", {
        jobId: job?.id,
        name: job?.name,
        error: describeError(error)
      });
    });
    worker.on("error", (error) => console.error("WhatsApp campaign worker error.", describeError(error)));
    await worker.waitUntilReady();
    await getCampaignQueue().waitUntilReady();
    console.info("Campaign worker startup: BullMQ worker and queue are ready.");

    await writeWorkerHeartbeat(connection);
    lastHeartbeatAt = Date.now();
    server = await startLivenessServer(
      worker,
      () => !isShuttingDown && Date.now() - lastHeartbeatAt < WORKER_HEARTBEAT_TTL_SECONDS * 1000
    );
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    heartbeatTimer = setInterval(() => {
      void writeWorkerHeartbeat(connection)
        .then(() => { lastHeartbeatAt = Date.now(); })
        .catch((error: unknown) => console.error("Campaign worker heartbeat failed.", describeError(error)));
    }, HEARTBEAT_INTERVAL_MS);

    const reconcile = async (startup = false) => {
      if (isShuttingDown || recoveryPromise) return;
      const currentRecovery = recoverQueuedWork();
      recoveryPromise = currentRecovery;
      try {
        await currentRecovery;
      } catch (error) {
        if (startup) throw error;
        console.error("Campaign queue recovery failed.", describeError(error));
      } finally {
        if (recoveryPromise === currentRecovery) recoveryPromise = undefined;
      }
    };

    await reconcile(true);
    recoveryTimer = setInterval(() => { void reconcile(); }, RECOVERY_INTERVAL_MS);
    console.info("WhatsApp campaign worker is running.", { region: process.env.VERCEL_REGION ?? "local" });
  } catch (error) {
    console.error("WhatsApp campaign worker could not start.", describeError(error));
    process.exitCode = 1;
    await shutdown("startup failure");
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

void startWorker().catch((error: unknown) => {
  console.error("WhatsApp campaign worker terminated unexpectedly.", describeError(error));
  process.exitCode = 1;
});
