import { NextResponse } from "next/server";
import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";
import {
  fetchUpcomingSessions,
  PadelAccountError,
  type UserSession,
} from "@/lib/padelAccount";
import {
  loadSnapshot,
  saveSnapshot,
  saveAvailability,
  isStateConfigured,
  loadUserSessions,
  saveUserSessions,
  loadRemindedSessions,
  saveRemindedSessions,
  loadSessionPlayers,
} from "@/lib/state";
import {
  sendOpeningEmail,
  sendFailureEmail,
  sendOpeningWhatsApp,
  sendUpcomingSessionsWhatsApp,
  sendCancellationReminderEmail,
  sendCancellationReminderWhatsApp,
  sendSessionBookedWhatsApp,
  sendSessionCancelledWhatsApp,
  type SlotOpening,
  type CronFailure,
  type UpcomingSessionSummary,
  type CancellationReminder,
  type SessionChangeNotice,
} from "@/lib/notify";
import { buildSessionKey } from "@/lib/sessions";
import { MAX_PLAYERS } from "@/lib/players";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type KeyedOpening = SlotOpening & { key: string };

const NOTIFY_WINDOW_START_MIN = 8 * 60;
const NOTIFY_WINDOW_END_MIN = 21 * 60 + 30;

const REMINDER_WINDOW_MIN_HOURS = 24;
const REMINDER_WINDOW_MAX_HOURS = 30;

function isWithinNotifyWindow(now: Date): boolean {
  const minutesGmt1 =
    (now.getUTCHours() * 60 + now.getUTCMinutes() + 60) % (24 * 60);
  return (
    minutesGmt1 >= NOTIFY_WINDOW_START_MIN &&
    minutesGmt1 <= NOTIFY_WINDOW_END_MIN
  );
}

function parseDublinLocalToUtc(date: string, time: string): Date | null {
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
  return new Date(asIfUtc - offset);
}

function dublinWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    weekday: "short",
  }).format(d);
}

function parseDublinSessionDate(date: string): Date | null {
  const [dd, mm, yyyy] = date.split("/").map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd, 12));
}

function sessionWeekday(date: string): string {
  const d = parseDublinSessionDate(date);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    weekday: "short",
  }).format(d);
}

async function sendUpcomingSummary(): Promise<{
  sent: boolean;
  reason?: string;
  count: number;
}> {
  const cached = await loadUserSessions();
  const sessions = cached?.sessions ?? [];
  if (sessions.length === 0) {
    return { sent: false, count: 0, reason: "no upcoming sessions cached" };
  }
  const summaries: UpcomingSessionSummary[] = sessions.map((s) => ({
    weekday: sessionWeekday(s.date),
    date: s.date,
    startTime: s.startTime,
    court: s.court,
    venue: s.venue,
    maxPlayers: MAX_PLAYERS,
  }));
  const result = await sendUpcomingSessionsWhatsApp(summaries);
  return { ...result, count: summaries.length };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isWithinNotifyWindow(new Date())) {
    const summary = {
      checkedAt: new Date().toISOString(),
      skipped: "outside notify window (08:00–21:30 GMT+1)",
    };
    console.log("[padel-poll]", JSON.stringify(summary));
    return NextResponse.json(summary);
  }

  const settle = async <T>(
    promise: Promise<T>,
  ): Promise<T | { sent: false; reason: string }> => {
    try {
      return await promise;
    } catch (err) {
      return {
        sent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // --- Sessions: refresh, change notifications, cancellation reminders ---
  type SessionsResult = {
    refreshed: boolean;
    booked: { sent: boolean; reason?: string };
    cancelled: { sent: boolean; reason?: string };
    reminders: {
      sent: number;
      email: { sent: boolean; reason?: string };
      whatsapp: { sent: boolean; reason?: string };
    };
    error?: string;
  };

  let sessionsResult: SessionsResult = {
    refreshed: false,
    booked: { sent: false, reason: "not run" },
    cancelled: { sent: false, reason: "not run" },
    reminders: {
      sent: 0,
      email: { sent: false, reason: "not run" },
      whatsapp: { sent: false, reason: "not run" },
    },
  };

  try {
    const previousData = await loadUserSessions();
    const { sessions } = await fetchUpcomingSessions();
    await saveUserSessions({ checkedAt: new Date().toISOString(), sessions });

    const changeResult = previousData
      ? await processSessionChanges(previousData.sessions, sessions)
      : {
          booked: { sent: false, reason: "first run" },
          cancelled: { sent: false, reason: "first run" },
        };

    const reminderResult = await processCancellationReminders(sessions);

    sessionsResult = {
      refreshed: true,
      booked: changeResult.booked,
      cancelled: changeResult.cancelled,
      reminders: reminderResult,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[padel-poll:check] session refresh failed", message);
    sessionsResult = { ...sessionsResult, error: message };
  }

  // --- Availability: fetch, snapshot diff, slot-opening notifications ---
  const venues = Object.keys(VENUES) as VenueKey[];
  const failures: CronFailure[] = [];
  const currentOpenings: KeyedOpening[] = [];
  const currentSeen: string[] = [];

  for (const key of venues) {
    try {
      const data = await getAvailability(key);
      await saveAvailability(key, {
        checkedAt: new Date().toISOString(),
        data,
      });
      for (const err of data.errors) {
        failures.push({
          stage: `fetch ${data.venue} ${err.date}`,
          detail: err.message,
        });
      }
      for (const day of data.days) {
        for (const court of day.courts) {
          const slotKey = `${data.venueId}:${day.date}:${day.hour}:${court.courtId}`;
          currentSeen.push(slotKey);
          if (!court.available) continue;
          currentOpenings.push({
            key: slotKey,
            venue: data.venue,
            weekday: day.weekday,
            date: day.date,
            hour: day.hour,
            courts: [court.courtName],
          });
        }
      }
    } catch (err) {
      failures.push({
        stage: `session ${VENUES[key].name}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let openingNotification: { sent: boolean; reason?: string; count: number } =
    { sent: false, count: 0 };
  let openingWhatsApp: { sent: boolean; reason?: string; count: number } = {
    sent: false,
    count: 0,
  };
  let summaryWhatsApp: { sent: boolean; reason?: string; count: number } = {
    sent: false,
    count: 0,
  };
  let failureNotification: { sent: boolean; reason?: string } = { sent: false };

  if (failures.length > 0) {
    failureNotification = await settle(sendFailureEmail(failures));
    openingNotification = {
      sent: false,
      count: 0,
      reason: "skipped: partial fetch failure",
    };
    openingWhatsApp = {
      sent: false,
      count: 0,
      reason: "skipped: partial fetch failure",
    };
  } else {
    const previous = await loadSnapshot();

    if (previous == null) {
      const reason = "first run; seeding state";
      openingNotification = { sent: false, count: 0, reason };
      openingWhatsApp = { sent: false, count: 0, reason };
    } else {
      const previousSeen = new Set(previous.seen);
      const previousOpen = new Set(previous.open);
      const reopened = currentOpenings.filter(
        (o) => previousSeen.has(o.key) && !previousOpen.has(o.key),
      );
      if (reopened.length > 0) {
        const grouped = new Map<string, SlotOpening>();
        for (const r of reopened) {
          const groupKey = `${r.venue}|${r.date}|${r.hour}`;
          const existing = grouped.get(groupKey);
          if (existing) {
            existing.courts.push(...r.courts);
          } else {
            grouped.set(groupKey, {
              venue: r.venue,
              weekday: r.weekday,
              date: r.date,
              hour: r.hour,
              courts: [...r.courts],
            });
          }
        }
        const groupedOpenings = Array.from(grouped.values());
        const [emailResult, waResult] = await Promise.all([
          settle(sendOpeningEmail(groupedOpenings)),
          settle(sendOpeningWhatsApp(groupedOpenings)),
        ]);
        openingNotification = { ...emailResult, count: reopened.length };
        openingWhatsApp = { ...waResult, count: reopened.length };

        if (waResult.sent) {
          try {
            summaryWhatsApp = await sendUpcomingSummary();
          } catch (err) {
            summaryWhatsApp = {
              sent: false,
              count: 0,
              reason: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
    }

    await saveSnapshot({
      ts: new Date().toISOString(),
      seen: currentSeen,
      open: currentOpenings.map((o) => o.key),
    });
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    stateConfigured: isStateConfigured(),
    sessions: sessionsResult,
    currentOpenings: currentOpenings.length,
    failures,
    openingNotification,
    openingWhatsApp,
    summaryWhatsApp,
    failureNotification,
  };
  console.log("[padel-poll]", JSON.stringify(summary));
  return NextResponse.json(summary);
}

async function processSessionChanges(
  previous: UserSession[],
  current: UserSession[],
): Promise<{
  booked: { sent: boolean; reason?: string };
  cancelled: { sent: boolean; reason?: string };
}> {
  const previousKeys = new Set(previous.map(buildSessionKey));
  const currentKeys = new Set(current.map(buildSessionKey));

  const booked = current.filter((s) => !previousKeys.has(buildSessionKey(s)));
  const cancelled = previous.filter((s) => !currentKeys.has(buildSessionKey(s)));

  const toNotice = (s: UserSession): SessionChangeNotice => {
    const start = parseDublinLocalToUtc(s.date, s.startTime);
    return {
      weekday: start ? dublinWeekday(start) : "",
      date: s.date,
      startTime: s.startTime,
      court: s.court,
      venue: s.venue,
      maxPlayers: MAX_PLAYERS,
    };
  };

  const settle = async (
    p: Promise<{ sent: boolean; reason?: string }>,
  ): Promise<{ sent: boolean; reason?: string }> => {
    try {
      return await p;
    } catch (err) {
      return {
        sent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const [bookedResult, cancelledResult] = await Promise.all([
    booked.length > 0
      ? settle(sendSessionBookedWhatsApp(booked.map(toNotice)))
      : Promise.resolve({ sent: false, reason: "no new sessions" }),
    cancelled.length > 0
      ? settle(sendSessionCancelledWhatsApp(cancelled.map(toNotice)))
      : Promise.resolve({ sent: false, reason: "no cancelled sessions" }),
  ]);

  return { booked: bookedResult, cancelled: cancelledResult };
}

async function processCancellationReminders(sessions: UserSession[]): Promise<{
  sent: number;
  email: { sent: boolean; reason?: string };
  whatsapp: { sent: boolean; reason?: string };
}> {
  const now = Date.now();
  const minMs = REMINDER_WINDOW_MIN_HOURS * 3_600_000;
  const maxMs = REMINDER_WINDOW_MAX_HOURS * 3_600_000;

  const currentKeys = new Set(sessions.map(buildSessionKey));
  const stored = await loadRemindedSessions();
  const alreadyReminded = new Set(
    (stored?.keys ?? []).filter((k) => currentKeys.has(k)),
  );

  type PendingReminder = {
    key: string;
    base: Omit<CancellationReminder, "players" | "maxPlayers">;
  };
  const pending: PendingReminder[] = [];
  for (const s of sessions) {
    const key = buildSessionKey(s);
    if (alreadyReminded.has(key)) continue;
    const start = parseDublinLocalToUtc(s.date, s.startTime);
    if (!start) continue;
    const delta = start.getTime() - now;
    if (delta > minMs && delta <= maxMs) {
      pending.push({
        key,
        base: {
          weekday: dublinWeekday(start),
          date: s.date,
          startTime: s.startTime,
          court: s.court,
          venue: s.venue,
          hoursUntil: Math.round(delta / 3_600_000),
        },
      });
    }
  }

  const playerLists = await Promise.all(
    pending.map((p) => loadSessionPlayers(p.key).catch(() => null)),
  );
  const due: CancellationReminder[] = pending.map((p, i) => ({
    ...p.base,
    players: playerLists[i] ?? [],
    maxPlayers: MAX_PLAYERS,
  }));

  let email: { sent: boolean; reason?: string } = {
    sent: false,
    reason: "no reminders due",
  };
  let whatsapp: { sent: boolean; reason?: string } = {
    sent: false,
    reason: "no reminders due",
  };

  if (due.length > 0) {
    const settle = async (
      p: Promise<{ sent: boolean; reason?: string }>,
    ): Promise<{ sent: boolean; reason?: string }> => {
      try {
        return await p;
      } catch (err) {
        return {
          sent: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    };
    [email, whatsapp] = await Promise.all([
      settle(sendCancellationReminderEmail(due)),
      settle(sendCancellationReminderWhatsApp(due)),
    ]);

    if (email.sent || whatsapp.sent) {
      for (const r of due) {
        alreadyReminded.add(`${r.venue}|${r.date}|${r.startTime}|${r.court}`);
      }
    }
  }

  await saveRemindedSessions({ keys: Array.from(alreadyReminded) });

  return { sent: due.length, email, whatsapp };
}
