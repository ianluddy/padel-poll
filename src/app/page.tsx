import { loadAvailability } from "@/lib/state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BOOKING_URL = "https://projectpadel.ie/Booking/Grid.aspx";

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
    const cached = await loadAvailability("galway");
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
          <p className="booking-link">
            <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer">
              Book a court →
            </a>
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
                      {day.courts.map((c) => {
                        const className = `court-chip ${c.available ? "available" : ""}`;
                        const labels = (
                          <>
                            <span className="court-label-full">{c.courtName}</span>
                            <span className="court-label-short">
                              {c.courtName.replace("Court", "Crt")}
                            </span>
                          </>
                        );
                        return c.available ? (
                          <a
                            key={c.courtId}
                            className={className}
                            href={BOOKING_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Free — book now"
                          >
                            {labels}
                          </a>
                        ) : (
                          <span
                            key={c.courtId}
                            className={className}
                            title="Booked"
                          >
                            {labels}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">
            Checked {formatCheckedAt(checkedAt)}
          </p>
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
