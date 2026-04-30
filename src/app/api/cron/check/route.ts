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

const NOTIFY_WINDOW_START_MIN = 7 * 60 + 10;
const NOTIFY_WINDOW_END_MIN = 22 * 60 + 40;

function isWithinNotifyWindow(now: Date): boolean {
  const minutesGmt1 =
    (now.getUTCHours() * 60 + now.getUTCMinutes() + 60) % (24 * 60);
  return (
    minutesGmt1 >= NOTIFY_WINDOW_START_MIN &&
    minutesGmt1 <= NOTIFY_WINDOW_END_MIN
  );
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isWithinNotifyWindow(new Date())) {
    const summary = {
      checkedAt: new Date().toISOString(),
      skipped: "outside notify window (07:10–22:40 GMT+1)",
    };
    console.log("[padel-poll]", JSON.stringify(summary));
    return NextResponse.json(summary);
  }

  const venues = Object.keys(VENUES) as VenueKey[];
  const failures: CronFailure[] = [];
  const currentOpenings: KeyedOpening[] = [];
  const currentSeen: string[] = [];

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
        const slotKey = `${data.venueId}:${day.date}:${day.hour}`;
        currentSeen.push(slotKey);
        if (!day.anyAvailable) continue;
        currentOpenings.push({
          key: slotKey,
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

    if (previous == null) {
      const reason = "first run; seeding state";
      openingNotification = { sent: false, count: 0, reason };
      openingWhatsApp = { sent: false, count: 0, reason };
    } else {
      const previousSeen = new Set(previous.seen);
      const previousOpen = new Set(previous.open);
      const reopened = currentOpenings.filter(
        (o) => previousSeen.has(o.key) && !previousOpen.has(o.key),
      );
      if (reopened.length > 0) {
        const [emailResult, waResult] = await Promise.all([
          settle(sendOpeningEmail(reopened)),
          settle(sendOpeningWhatsApp(reopened)),
        ]);
        openingNotification = { ...emailResult, count: reopened.length };
        openingWhatsApp = { ...waResult, count: reopened.length };
      }
    }

    await saveSnapshot({
      ts: new Date().toISOString(),
      seen: currentSeen,
      open: currentOpenings.map((o) => o.key),
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
