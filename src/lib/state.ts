import { Redis } from "@upstash/redis";
import type { VenueAvailability, VenueKey } from "./padel";
import type { UserSession } from "./padelAccount";

const SNAPSHOT_KEY = "padel:lastSnapshot";
const AVAILABILITY_KEY_PREFIX = "padel:availability:";
const USER_SESSIONS_KEY = "padel:userSessions";
const REMINDED_SESSIONS_KEY = "padel:remindedSessions";
const SESSION_PLAYERS_KEY_PREFIX = "padel:sessionPlayers:";
const SESSION_PLAYERS_TTL_SECONDS = 60 * 24 * 60 * 60;

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

export type CachedUserSessions = {
  checkedAt: string;
  sessions: UserSession[];
};

export async function loadUserSessions(): Promise<CachedUserSessions | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<CachedUserSessions>(USER_SESSIONS_KEY)) ?? null;
}

export async function saveUserSessions(
  cached: CachedUserSessions,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(USER_SESSIONS_KEY, cached);
}

export type RemindedSessions = {
  keys: string[];
};

export async function loadRemindedSessions(): Promise<RemindedSessions | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<RemindedSessions>(REMINDED_SESSIONS_KEY)) ?? null;
}

export async function saveRemindedSessions(
  reminded: RemindedSessions,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(REMINDED_SESSIONS_KEY, reminded);
}

export type SessionPlayers = {
  players: string[];
  updatedAt: string;
};

export async function loadSessionPlayers(
  sessionKey: string,
): Promise<string[] | null> {
  const r = getRedis();
  if (!r) return null;
  const stored = await r.get<SessionPlayers>(
    SESSION_PLAYERS_KEY_PREFIX + sessionKey,
  );
  return stored?.players ?? null;
}

export async function loadSessionPlayersMany(
  sessionKeys: string[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (sessionKeys.length === 0) return out;
  const r = getRedis();
  if (!r) return out;
  const redisKeys = sessionKeys.map((k) => SESSION_PLAYERS_KEY_PREFIX + k);
  const values = await r.mget<(SessionPlayers | null)[]>(...redisKeys);
  sessionKeys.forEach((k, i) => {
    const v = values[i];
    if (v && Array.isArray(v.players)) out[k] = v.players;
  });
  return out;
}

export async function saveSessionPlayers(
  sessionKey: string,
  players: string[],
): Promise<SessionPlayers> {
  const r = getRedis();
  const payload: SessionPlayers = {
    players,
    updatedAt: new Date().toISOString(),
  };
  if (!r) return payload;
  await r.set(SESSION_PLAYERS_KEY_PREFIX + sessionKey, payload, {
    ex: SESSION_PLAYERS_TTL_SECONDS,
  });
  return payload;
}

export function isStateConfigured(): boolean {
  return getRedis() !== null;
}
