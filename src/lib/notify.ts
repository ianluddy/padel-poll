import { Resend } from "resend";

export type SlotOpening = {
  venue: string;
  weekday: string;
  date: string;
  hour: string;
  courts: string[];
};

export type CronFailure = {
  stage: string;
  detail: string;
};

function getEnv(): {
  apiKey: string | undefined;
  to: string | undefined;
  from: string;
} {
  return {
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM ?? "Padel Poll <onboarding@resend.dev>",
  };
}

export async function sendOpeningEmail(
  openings: SlotOpening[],
): Promise<{ sent: boolean; reason?: string }> {
  const { apiKey, to, from } = getEnv();
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

export async function sendFailureEmail(
  failures: CronFailure[],
): Promise<{ sent: boolean; reason?: string }> {
  const { apiKey, to, from } = getEnv();
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "EMAIL_TO not set" };

  const resend = new Resend(apiKey);
  const subject = `Padel Poll cron failed (${failures.length})`;
  const rows = failures
    .map(
      (f) =>
        `<tr><td><code>${f.stage}</code></td><td><code>${f.detail}</code></td></tr>`,
    )
    .join("");
  const html = `
    <p>The padel poll cron run hit failures and the snapshot was not updated.</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
      <thead><tr><th>Stage</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  const text = failures.map((f) => `${f.stage}: ${f.detail}`).join("\n");

  await resend.emails.send({ from, to, subject, html, text });
  return { sent: true };
}
