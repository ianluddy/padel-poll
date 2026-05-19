import { createHash } from "node:crypto";
import { buildSessionKey } from "./sessions";
import type { UserSession } from "./padelAccount";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
};

function getConfig(): GoogleCalendarConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
  };
}

export function isGoogleCalendarConfigured(): boolean {
  return getConfig() !== null;
}

async function getAccessToken(config: GoogleCalendarConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GoogleCalendarError(
      `Token exchange failed: ${res.status} ${detail.slice(0, 200)}`,
      "auth",
    );
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new GoogleCalendarError(
      "Token response missing access_token",
      "auth",
    );
  }
  return data.access_token;
}

function eventIdForSessionKey(sessionKey: string): string {
  // sha1 hex is 40 chars in [0-9a-f] — within Google Calendar's allowed
  // [a-v0-9] event-id alphabet (length 5-1024).
  return createHash("sha1").update(sessionKey).digest("hex");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type LocalDateTime = { iso: string };

function parseDublinDateTime(date: string, time: string): LocalDateTime | null {
  const [dd, mm, yyyy] = date.split("/").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  if (!dd || !mm || !yyyy || Number.isNaN(hh) || Number.isNaN(mi)) return null;
  return {
    iso: `${yyyy}-${pad2(mm)}-${pad2(dd)}T${pad2(hh)}:${pad2(mi)}:00`,
  };
}

function addHourToIso(iso: string): string {
  const [datePart, timePart] = iso.split("T");
  const [hh, mm] = timePart.split(":");
  const endHour = (parseInt(hh, 10) + 1) % 24;
  return `${datePart}T${pad2(endHour)}:${mm}:00`;
}

function parseDublinLocalToUtcMs(date: string, time: string): number | null {
  const [dd, mm, yyyy] = date.split("/").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  if (!dd || !mm || !yyyy || Number.isNaN(hh) || Number.isNaN(mi)) return null;
  const asIfUtc = Date.UTC(yyyy, mm - 1, dd, hh, mi);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(asIfUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const dublinAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
  );
  const offset = dublinAsUtc - asIfUtc;
  return asIfUtc - offset;
}

function buildEventBody(
  session: UserSession,
  eventId: string,
  players: string[],
): Record<string, unknown> | null {
  const start = parseDublinDateTime(session.date, session.startTime);
  if (!start) return null;

  let end: LocalDateTime | null = session.endTime
    ? parseDublinDateTime(session.date, session.endTime)
    : null;
  if (!end) end = { iso: addHourToIso(start.iso) };

  const descLines: string[] = [];
  if (players.length > 0) {
    descLines.push(`Players: ${players.join(", ")}`);
  }
  if (session.bookingUrl) {
    descLines.push(`Booking: ${session.bookingUrl}`);
  }
  descLines.push("Synced by padel-poll.");

  return {
    id: eventId,
    summary: `Padel — ${session.court}`,
    location: session.venue,
    description: descLines.join("\n"),
    start: { dateTime: start.iso, timeZone: "Europe/Dublin" },
    end: { dateTime: end.iso, timeZone: "Europe/Dublin" },
    source: session.bookingUrl
      ? { title: "padel-poll", url: session.bookingUrl }
      : undefined,
  };
}

type UpsertResult =
  | { ok: true; action: "created" | "updated" }
  | { ok: false; reason: string };

async function upsertEvent(
  config: GoogleCalendarConfig,
  accessToken: string,
  sessionKey: string,
  session: UserSession,
  players: string[],
): Promise<UpsertResult> {
  const eventId = eventIdForSessionKey(sessionKey);
  const body = buildEventBody(session, eventId, players);
  if (!body) return { ok: false, reason: "invalid date/time" };

  const calendarPath = `/calendars/${encodeURIComponent(config.calendarId)}`;
  const insertRes = await fetch(`${CALENDAR_API_BASE}${calendarPath}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (insertRes.ok) return { ok: true, action: "created" };
  if (insertRes.status === 409) {
    const updateRes = await fetch(
      `${CALENDAR_API_BASE}${calendarPath}/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (updateRes.ok) return { ok: true, action: "updated" };
    const detail = await updateRes.text().catch(() => "");
    return {
      ok: false,
      reason: `update ${updateRes.status}: ${detail.slice(0, 200)}`,
    };
  }
  const detail = await insertRes.text().catch(() => "");
  return {
    ok: false,
    reason: `insert ${insertRes.status}: ${detail.slice(0, 200)}`,
  };
}

async function deleteEvent(
  config: GoogleCalendarConfig,
  accessToken: string,
  sessionKey: string,
): Promise<{ ok: boolean; reason?: string }> {
  const eventId = eventIdForSessionKey(sessionKey);
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(config.calendarId)}/events/${eventId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  // 404 = already gone, 410 = already deleted — both fine.
  if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
  const detail = await res.text().catch(() => "");
  return { ok: false, reason: `${res.status}: ${detail.slice(0, 200)}` };
}

export type CalendarSyncResult = {
  configured: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: Array<{ sessionKey?: string; reason: string }>;
};

export type CalendarSyncOutcome = {
  result: CalendarSyncResult;
  syncedKeys: string[];
};

function emptyResult(configured: boolean): CalendarSyncResult {
  return {
    configured,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    failed: [],
  };
}

export async function syncSessionsToCalendar(
  sessions: UserSession[],
  previousKeys: string[],
  playersByKey: Record<string, string[]>,
): Promise<CalendarSyncOutcome> {
  const config = getConfig();
  if (!config) {
    return {
      result: emptyResult(false),
      syncedKeys: previousKeys,
    };
  }

  // Only sync sessions that haven't already ended. Allow a 1h grace so a
  // session currently in progress still gets reflected.
  const cutoff = Date.now() - 60 * 60 * 1000;
  const upcoming = sessions.filter((s) => {
    const startMs = parseDublinLocalToUtcMs(s.date, s.startTime);
    return startMs !== null && startMs > cutoff;
  });

  const currentKeys = upcoming.map(buildSessionKey);
  const currentSet = new Set(currentKeys);
  const toDelete = previousKeys.filter((k) => !currentSet.has(k));

  let accessToken: string;
  try {
    accessToken = await getAccessToken(config);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const result = emptyResult(true);
    result.failed.push({ reason });
    // Preserve previousKeys so we can retry deletions next run.
    return { result, syncedKeys: previousKeys };
  }

  const result = emptyResult(true);
  const surviving = new Set<string>();

  for (const s of upcoming) {
    const key = buildSessionKey(s);
    const players = playersByKey[key] ?? [];
    const r = await upsertEvent(config, accessToken, key, s, players);
    if (r.ok) {
      if (r.action === "created") result.created++;
      else result.updated++;
      surviving.add(key);
    } else {
      result.failed.push({ sessionKey: key, reason: r.reason });
      // Keep the key around so we don't try to delete an event we may have
      // successfully created on a previous run.
      if (previousKeys.includes(key)) surviving.add(key);
    }
  }

  for (const key of toDelete) {
    const r = await deleteEvent(config, accessToken, key);
    if (r.ok) {
      result.deleted++;
    } else {
      result.failed.push({ sessionKey: key, reason: r.reason ?? "unknown" });
      surviving.add(key);
    }
  }

  return { result, syncedKeys: Array.from(surviving) };
}
