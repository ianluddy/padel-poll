import { getAvailability } from "@/lib/padel";

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

export default async function Home() {
  let body: React.ReactNode;
  try {
    const data = await getAvailability("galway");
    body = (
      <>
        <p className="subtitle">
          {data.venue} · Mon-Thur 8pm Slots
        </p>
        <p className="meta">
          Last checked {new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}
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
