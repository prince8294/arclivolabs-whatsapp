import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { verifyQueueInfrastructure } from "@/lib/campaigns/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  let redis = false;
  let worker = false;
  try {
    const connection = await connectToDatabase();
    await connection.connection.db?.admin().ping();
    database = true;
  } catch {
    console.error("Health check: MongoDB connection failed.");
  }
  try {
    const queue = await verifyQueueInfrastructure(false);
    redis = queue.redis;
    worker = queue.worker;
  } catch (error) {
    console.error("Health check: Redis connection failed.", error instanceof Error ? error.message : "Unknown Redis error");
  }
  const healthy = database && redis && worker;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database, redis, worker },
    { status: database && redis ? 200 : 503 }
  );
}
