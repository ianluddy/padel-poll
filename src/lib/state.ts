import { Redis } from "@upstash/redis";

const SNAPSHOT_KEY = "padel:lastSnapshot";

export type Snapshot = {
  ts: string;
  slots: string[];
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<Snapshot>(SNAPSHOT_KEY)) ?? null;
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(SNAPSHOT_KEY, snapshot);
}

export function isStateConfigured(): boolean {
  return getRedis() !== null;
}
