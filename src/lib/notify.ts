import { Resend } from "resend";

export type SlotOpening = {
  venue: string;
  weekday: string;
  date: string;
  hour: string;
  courts: string[];
};

export async function sendOpeningEmail(
  openings: SlotOpening[],
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  const from =
    process.env.EMAIL_FROM ?? "Padel Poll <onboarding@resend.dev>";

  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "EMAIL_TO not set" };

  const resend = new Resend(apiKey);
  const subject =
    openings.length === 1
      ? `Padel slot open: ${openings[0].weekday} ${openings[0].date} ${openings[0].hour}`
      : `${openings.length} new padel slots open`;

  const rows = openings
    .map(
      (o) =>
        `<tr><td>${o.weekday}</td><td>${o.date}</td><td>${o.hour}</td><td>${o.venue}</td><td>${o.courts.join(", ")}</td></tr>`,
    )
    .join("");

  const html = `
    <p>The following padel slots just opened up:</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <thead><tr><th>Day</th><th>Date</th><th>Time</th><th>Venue</th><th>Free courts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="https://projectpadel.ie/Booking/Grid.aspx">Book now →</a></p>
  `;

  const text = openings
    .map(
      (o) =>
        `${o.weekday} ${o.date} ${o.hour} — ${o.venue} (${o.courts.join(", ")})`,
    )
    .join("\n");

  await resend.emails.send({ from, to, subject, html, text });
  return { sent: true };
}
