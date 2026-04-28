import { getAvailability, VENUES, type VenueKey } from "@/lib/padel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = { venue?: string };

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const venueKey: VenueKey =
    searchParams.venue === "mayo" ? "mayo" : "galway";

  let body: React.ReactNode;
  try {
    const data = await getAvailability(venueKey);
    body = (
      <>
        <p className="subtitle">
          {data.venue} · weekday {data.hour} slots · next 21 days
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th>Status</th>
              <th>Courts</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.weekday}</td>
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
                        {c.courtName}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          Last checked {new Date().toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}
        </p>
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
      <nav className="venue-tabs">
        {(Object.keys(VENUES) as VenueKey[]).map((key) => (
          <a
            key={key}
            href={`/?venue=${key}`}
            className={key === venueKey ? "active" : ""}
          >
            {VENUES[key].name}
          </a>
        ))}
      </nav>
      {body}
    </main>
  );
}
