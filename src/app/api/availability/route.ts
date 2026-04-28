import { NextResponse } from "next/server";
import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const venueParam = url.searchParams.get("venue") ?? "galway";
  if (!(venueParam in VENUES)) {
    return NextResponse.json(
      { error: `Unknown venue. Use one of: ${Object.keys(VENUES).join(", ")}` },
      { status: 400 },
    );
  }
  const hourParam = url.searchParams.get("hour");
  const hour = hourParam ? Number(hourParam) : 20;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: "hour must be 0-23" }, { status: 400 });
  }

  try {
    const data = await getAvailability(venueParam as VenueKey, { hour });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
