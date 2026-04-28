import { NextResponse } from "next/server";
import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";
import { loadSnapshot, saveSnapshot, isStateConfigured } from "@/lib/state";
import { sendOpeningEmail, type SlotOpening } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type KeyedOpening = SlotOpening & { key: string };

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const venues = Object.keys(VENUES) as VenueKey[];
  const venueData = await Promise.all(venues.map((v) => getAvailability(v)));

  const currentOpenings: KeyedOpening[] = [];
  for (const data of venueData) {
    for (const day of data.days) {
      if (!day.anyAvailable) continue;
      currentOpenings.push({
        key: `${data.venueId}:${day.date}:${day.hour}`,
        venue: data.venue,
        weekday: day.weekday,
        date: day.date,
        hour: day.hour,
        courts: day.courts.filter((c) => c.available).map((c) => c.courtName),
      });
    }
  }

  const previous = await loadSnapshot();
  const previousSet = new Set(previous?.slots ?? []);
  const newOpenings = currentOpenings.filter((o) => !previousSet.has(o.key));

  let notification: { sent: boolean; reason?: string; count: number } = {
    sent: false,
    count: 0,
  };
  if (previous == null) {
    notification = { sent: false, count: 0, reason: "first run; seeding state" };
  } else if (newOpenings.length > 0) {
    const result = await sendOpeningEmail(newOpenings);
    notification = { ...result, count: newOpenings.length };
  }

  await saveSnapshot({
    ts: new Date().toISOString(),
    slots: currentOpenings.map((o) => o.key),
  });

  const summary = {
    checkedAt: new Date().toISOString(),
    stateConfigured: isStateConfigured(),
    currentOpenings: currentOpenings.length,
    newOpenings: newOpenings.length,
    notification,
  };
  console.log("[padel-poll]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
