import { NextResponse } from "next/server";
import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";
import {
  loadSnapshot,
  saveSnapshot,
  saveAvailability,
  isStateConfigured,
} from "@/lib/state";
import {
  sendOpeningEmail,
  sendFailureEmail,
  type SlotOpening,
  type CronFailure,
} from "@/lib/notify";
import {
  sendOpeningWhatsApp,
  sendFailureWhatsApp,
} from "@/lib/whatsapp";

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
  const failures: CronFailure[] = [];
  const currentOpenings: KeyedOpening[] = [];

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
    } catch (err) {
      failures.push({
        stage: `session ${VENUES[key].name}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let openingNotification: {
    email: { sent: boolean; reason?: string };
    whatsapp: { sent: boolean; reason?: string };
    count: number;
  } = {
    email: { sent: false },
    whatsapp: { sent: false },
    count: 0,
  };
  let failureNotification: {
    email: { sent: boolean; reason?: string };
    whatsapp: { sent: boolean; reason?: string };
  } = { email: { sent: false }, whatsapp: { sent: false } };

  if (failures.length > 0) {
    const [emailRes, waRes] = await Promise.all([
      sendFailureEmail(failures),
      sendFailureWhatsApp(failures),
    ]);
    failureNotification = { email: emailRes, whatsapp: waRes };
    openingNotification = {
      email: { sent: false, reason: "skipped: partial fetch failure" },
      whatsapp: { sent: false, reason: "skipped: partial fetch failure" },
      count: 0,
    };
  } else {
    const previous = await loadSnapshot();
    const previousSet = new Set(previous?.slots ?? []);
    const newOpenings = currentOpenings.filter((o) => !previousSet.has(o.key));

    if (previous == null) {
      openingNotification = {
        email: { sent: false, reason: "first run; seeding state" },
        whatsapp: { sent: false, reason: "first run; seeding state" },
        count: 0,
      };
    } else if (newOpenings.length > 0) {
      const [emailRes, waRes] = await Promise.all([
        sendOpeningEmail(newOpenings),
        sendOpeningWhatsApp(newOpenings),
      ]);
      openingNotification = {
        email: emailRes,
        whatsapp: waRes,
        count: newOpenings.length,
      };
    }

    await saveSnapshot({
      ts: new Date().toISOString(),
      slots: currentOpenings.map((o) => o.key),
    });
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    stateConfigured: isStateConfigured(),
    currentOpenings: currentOpenings.length,
    failures,
    openingNotification,
    failureNotification,
  };
  console.log("[padel-poll]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
