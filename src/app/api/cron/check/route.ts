import { NextResponse } from "next/server";
import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const venues = Object.keys(VENUES) as VenueKey[];
  const results = await Promise.all(
    venues.map(async (venue) => {
      try {
        const data = await getAvailability(venue);
        const free = data.days.filter((d) => d.anyAvailable);
        return {
          venue: data.venue,
          totalDays: data.days.length,
          availableDays: free.length,
          available: free.map((d) => `${d.weekday} ${d.date}`),
        };
      } catch (err) {
        return {
          venue: VENUES[venue].name,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  console.log("[padel-poll]", JSON.stringify(results));
  return NextResponse.json({ checkedAt: new Date().toISOString(), results });
}
