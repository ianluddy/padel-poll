import { loadAvailability, type CachedAvailability } from "@/lib/state";
import type { DaySlot } from "@/lib/padel";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildDemoCache(): CachedAvailability {
  const today = new Date();
  const days: DaySlot[] = [];
  for (let i = 0; i < 30 && days.length < 14; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const dow = d.getDay();
    if (dow < 1 || dow > 4) continue;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const date = `${dd}/${mm}/${d.getFullYear()}`;
    const seed = (d.getDate() + d.getMonth()) % 4;
    const courts = [1, 2, 3].map((n) => ({
      courtId: String(n),
      courtName: `Court ${n}`,
      available: seed === n - 1,
    }));
    days.push({
      date,
      weekday: WEEKDAY_NAMES[dow],
      hour: "20:00",
      courts,
      anyAvailable: courts.some((c) => c.available),
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    data: {
      venue: "Project Padel Galway",
      venueId: 4,
      hour: "20:00",
      errors: [],
      days,
    },
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDayLabel(date: string, weekday: string): string {
  const [dd, mm] = date.split("/");
  return `${weekday} ${MONTHS[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}`;
}

function formatCheckedAt(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export default async function Home() {
  let body: React.ReactNode;
  try {
    const cached =
      (await loadAvailability("galway")) ??
      (process.env.PADEL_DEMO === "1" ? buildDemoCache() : null);
    if (!cached) {
      body = (
        <div className="error">
          No availability data yet — waiting for the next scheduled check.
        </div>
      );
    } else {
      const { data, checkedAt } = cached;
      body = (
        <>
          <p className="subtitle">
            {data.venue} · Mon-Thur 8pm Slots
          </p>
          <p className="meta">
            Checked {formatCheckedAt(checkedAt)}
          </p>
          <table>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.date}>
                  <td>{formatDayLabel(day.date, day.weekday)}</td>
                  <td>
                    <span
                      className={`pill ${day.anyAvailable ? "available" : "busy"}`}
                    >
                      {day.anyAvailable ? "Available" : "Booked"}
                    </span>
                  </td>
                  <td>
                    <div className="courts">
                      {day.courts.map((c) => (
                        <span
                          key={c.courtId}
                          className={`court-chip ${c.available ? "available" : ""}`}
                          title={c.available ? "Free" : "Booked"}
                        >
                          <span className="court-label-full">{c.courtName}</span>
                          <span className="court-label-short">
                            {c.courtName.replace("Court", "Crt")}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    }
  } catch (err) {
    body = (
      <div className="error">
        Failed to load availability:{" "}
        {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  return (
    <main>
      <h1>Padel Poll</h1>
      {body}
    </main>
  );
}
