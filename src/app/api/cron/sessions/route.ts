import { NextResponse } from "next/server";
import {
  fetchUpcomingSessions,
  PadelAccountError,
  type UserSession,
} from "@/lib/padelAccount";
import {
  saveUserSessions,
  isStateConfigured,
  loadRemindedSessions,
  saveRemindedSessions,
} from "@/lib/state";
import {
  sendCancellationReminderEmail,
  sendCancellationReminderWhatsApp,
  type CancellationReminder,
} from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REMINDER_WINDOW_MIN_HOURS = 24;
const REMINDER_WINDOW_MAX_HOURS = 30;

function sessionKey(session: UserSession): string {
  return `${session.venue}|${session.date}|${session.startTime}|${session.court}`;
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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  try {
    const { sessions, rawSnippet } = await fetchUpcomingSessions();
    await saveUserSessions({ checkedAt, sessions });

    const reminderResult = await processCancellationReminders(sessions);

    const summary = {
      ok: true,
      checkedAt,
      count: sessions.length,
      stateConfigured: isStateConfigured(),
      reminders: reminderResult,
      ...(rawSnippet ? { rawSnippet } : {}),
    };
    console.log("[padel-poll:sessions]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const stage = err instanceof PadelAccountError ? err.stage : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    const status = stage === "login-rejected" || stage === "config" ? 401 : 500;
    const summary = { ok: false, checkedAt, stage, message };
    console.error("[padel-poll:sessions]", JSON.stringify(summary));
    return NextResponse.json(summary, { status });
  }
}

async function processCancellationReminders(sessions: UserSession[]): Promise<{
  sent: number;
  email: { sent: boolean; reason?: string };
  whatsapp: { sent: boolean; reason?: string };
}> {
  const now = Date.now();
  const minMs = REMINDER_WINDOW_MIN_HOURS * 3_600_000;
  const maxMs = REMINDER_WINDOW_MAX_HOURS * 3_600_000;

  const currentKeys = new Set(sessions.map(sessionKey));
  const stored = await loadRemindedSessions();
  const alreadyReminded = new Set(
    (stored?.keys ?? []).filter((k) => currentKeys.has(k)),
  );

  const due: CancellationReminder[] = [];
  for (const s of sessions) {
    const key = sessionKey(s);
    if (alreadyReminded.has(key)) continue;
    const start = parseDublinLocalToUtc(s.date, s.startTime);
    if (!start) continue;
    const delta = start.getTime() - now;
    if (delta > minMs && delta <= maxMs) {
      due.push({
        weekday: dublinWeekday(start),
        date: s.date,
        startTime: s.startTime,
        court: s.court,
        venue: s.venue,
        hoursUntil: Math.round(delta / 3_600_000),
      });
    }
  }

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
        alreadyReminded.add(
          `${r.venue}|${r.date}|${r.startTime}|${r.court}`,
        );
      }
    }
  }

  await saveRemindedSessions({ keys: Array.from(alreadyReminded) });

  return { sent: due.length, email, whatsapp };
}
