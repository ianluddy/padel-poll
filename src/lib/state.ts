import { Redis } from "@upstash/redis";
import type { VenueAvailability, VenueKey } from "./padel";

const SNAPSHOT_KEY = "padel:lastSnapshot";
const AVAILABILITY_KEY_PREFIX = "padel:availability:";

export type Snapshot = {
  ts: string;
  seen: string[];
  open: string[];
};

type StoredSnapshot = Partial<Snapshot> & { slots?: string[] };

export type CachedAvailability = {
  checkedAt: string;
  data: VenueAvailability;
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
  const stored = await r.get<StoredSnapshot>(SNAPSHOT_KEY);
  if (!stored) return null;
  if (stored.seen && stored.open) {
    return { ts: stored.ts ?? "", seen: stored.seen, open: stored.open };
  }
  const legacy = stored.slots ?? [];
  return { ts: stored.ts ?? "", seen: legacy, open: legacy };
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(SNAPSHOT_KEY, snapshot);
}

export async function loadAvailability(
  venueKey: VenueKey,
): Promise<CachedAvailability | null> {
  const r = getRedis();
  if (!r) return null;
  return (
    (await r.get<CachedAvailability>(AVAILABILITY_KEY_PREFIX + venueKey)) ??
    null
  );
}

export async function saveAvailability(
  venueKey: VenueKey,
  cached: CachedAvailability,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(AVAILABILITY_KEY_PREFIX + venueKey, cached);
}

export function isStateConfigured(): boolean {
  return getRedis() !== null;
}
