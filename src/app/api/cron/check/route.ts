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
  sendOpeningWhatsApp,
  sendFailureWhatsApp,
  type SlotOpening,
  type CronFailure,
} from "@/lib/notify";

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

  let openingNotification: { sent: boolean; reason?: string; count: number } = {
    sent: false,
    count: 0,
  };
  let openingWhatsApp: { sent: boolean; reason?: string; count: number } = {
    sent: false,
    count: 0,
  };
  let failureNotification: { sent: boolean; reason?: string } = { sent: false };
  let failureWhatsApp: { sent: boolean; reason?: string } = { sent: false };

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

  if (failures.length > 0) {
    const [emailResult, waResult] = await Promise.all([
      settle(sendFailureEmail(failures)),
      settle(sendFailureWhatsApp(failures)),
    ]);
    failureNotification = emailResult;
    failureWhatsApp = waResult;
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
    const previousSet = new Set(previous?.slots ?? []);
    const newOpenings = currentOpenings.filter((o) => !previousSet.has(o.key));

    if (previous == null) {
      const reason = "first run; seeding state";
      openingNotification = { sent: false, count: 0, reason };
      openingWhatsApp = { sent: false, count: 0, reason };
    } else if (newOpenings.length > 0) {
      const [emailResult, waResult] = await Promise.all([
        settle(sendOpeningEmail(newOpenings)),
        settle(sendOpeningWhatsApp(newOpenings)),
      ]);
      openingNotification = { ...emailResult, count: newOpenings.length };
      openingWhatsApp = { ...waResult, count: newOpenings.length };
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
    openingWhatsApp,
    failureNotification,
    failureWhatsApp,
  };
  console.log("[padel-poll]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
