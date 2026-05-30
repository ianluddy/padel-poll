import { NextResponse } from "next/server";
import { loadUserSessions, loadSessionPlayersMany } from "@/lib/state";
import {
  sendFillBookingWhatsApp,
  type UpcomingSessionSummary,
} from "@/lib/notify";
import { buildSessionKey } from "@/lib/sessions";
import { MAX_PLAYERS } from "@/lib/players";

export const dynamic = "force-dynamic";

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

export async function POST() {
  try {
    const cached = await loadUserSessions();
    const sessions = cached?.sessions ?? [];

    if (sessions.length === 0) {
      return NextResponse.json({
        sent: false,
        reason: "No upcoming sessions found",
      });
    }

    const keys = sessions.map(buildSessionKey);
    const playerMap = await loadSessionPlayersMany(keys);

    const summaries: UpcomingSessionSummary[] = sessions.map((s) => ({
      weekday: sessionWeekday(s.date),
      date: s.date,
      startTime: s.startTime,
      court: s.court,
      venue: s.venue,
      players: playerMap[buildSessionKey(s)] ?? [],
      maxPlayers: MAX_PLAYERS,
    }));

    const result = await sendFillBookingWhatsApp(summaries);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        sent: false,
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
