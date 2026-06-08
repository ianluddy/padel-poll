import { NextResponse } from "next/server";
import { loadUserSessions, loadSessionPlayersMany } from "@/lib/state";
import { buildSessionKey } from "@/lib/sessions";
import { MAX_PLAYERS, PLAYERS } from "@/lib/players";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinalSuffix(d: number): string {
  const mod10 = d % 10;
  const mod100 = d % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (mod10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
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

function formatDate(weekday: string, dateStr: string): string {
  const [dd, mm] = dateStr.split("/").map(Number);
  if (!dd || !mm || mm < 1 || mm > 12) return `${weekday} ${dateStr}`;
  return `${weekday} ${MONTH_NAMES[mm - 1]} ${dd}${ordinalSuffix(dd)}`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cached = await loadUserSessions();
  const sessions = cached?.sessions ?? [];
  if (sessions.length === 0) {
    return NextResponse.json({ message: null, reason: "no upcoming sessions cached" });
  }

  const keys = sessions.map(buildSessionKey);
  const playerMap = await loadSessionPlayersMany(keys);

  const lines = sessions.map((s, i) => {
    const key = keys[i];
    const players = playerMap[key] ?? [];
    const slots: string[] = [];
    for (let j = 0; j < MAX_PLAYERS; j++) {
      slots.push(players[j] ?? "[Slot available]");
    }
    return `• ${formatDate(sessionWeekday(s.date), s.date)} ${s.startTime} - ${s.court}\n   ${slots.join(", ")}`;
  });

  const message = `Upcoming sessions:\n${lines.join("\n")}`;

  return NextResponse.json({
    message,
    sessions: sessions.map((s, i) => ({
      key: keys[i],
      date: s.date,
      startTime: s.startTime,
      court: s.court,
      players: playerMap[keys[i]] ?? [],
      playerCount: (playerMap[keys[i]] ?? []).length,
      maxPlayers: MAX_PLAYERS,
    })),
  });
}
