import { NextResponse } from "next/server";
import { loadUserSessions, loadSessionPlayersMany } from "@/lib/state";
import { parseDublinLocalToUtc } from "@/lib/dublinTime";
import { buildSessionKey } from "@/lib/sessions";
import { MAX_PLAYERS } from "@/lib/players";
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

// RFC 5545 requires content lines to be folded at 75 octets, continuation
// lines prefixed with a single space.
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  for (const char of line) {
    const candidate = current + char;
    if (encoder.encode(candidate).length > 75 && current !== "") {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join("\r\n");
}

function playersDescription(players: string[]): string {
  const slots: string[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    slots.push(players[i] ? `${players[i]} 🎾` : "[Slot available]");
  }
  return slots.join("\n");
}

async function sessionToEvent(
  s: UserSession,
  now: Date,
  playerMap: Record<string, string[]>,
): Promise<string | null> {
  const start = parseDublinLocalToUtc(s.date, s.startTime);
  const end = parseDublinLocalToUtc(s.date, s.endTime);
  if (!start || !end) return null;

  const uid = `${buildSessionKey(s)}@padel-poll.vercel.app`;
  const summary = icsEscape(`Padel — ${s.court}`);
  const location = icsEscape(s.venue);
  const description = icsEscape(
    playersDescription(playerMap[buildSessionKey(s)] ?? []),
  );

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
  ]
    .map(foldLine)
    .join("\r\n");
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
  const playerMap = await loadSessionPlayersMany(sessions.map(buildSessionKey));

  const events = (
    await Promise.all(sessions.map((s) => sessionToEvent(s, now, playerMap)))
  ).filter((e): e is string => e !== null);

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
