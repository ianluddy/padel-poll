import { NextResponse } from "next/server";
import { loadUserSessions } from "@/lib/state";
import { parseDublinLocalToUtc } from "@/lib/dublinTime";
import { buildSessionKey } from "@/lib/sessions";
import type { UserSession } from "@/lib/padelAccount";

export const dynamic = "force-dynamic";

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function sessionToEvent(s: UserSession, now: Date): string | null {
  const start = parseDublinLocalToUtc(s.date, s.startTime);
  const end = parseDublinLocalToUtc(s.date, s.endTime);
  if (!start || !end) return null;

  const uid = `${buildSessionKey(s)}@padel-poll.vercel.app`;
  const summary = icsEscape(`Padel — ${s.court}`);
  const location = icsEscape(s.venue);

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    "END:VEVENT",
  ].join("\r\n");
}

export async function GET(request: Request) {
  const expected = process.env.CALENDAR_FEED_TOKEN;
  if (expected) {
    const token = new URL(request.url).searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const cached = await loadUserSessions();
  const sessions = cached?.sessions ?? [];
  const now = new Date();

  const events = sessions
    .map((s) => sessionToEvent(s, now))
    .filter((e): e is string => e !== null);

  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//padel-poll//upcoming-sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Padel sessions",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="padel-sessions.ics"',
      "Cache-Control": "no-store",
    },
  });
}
