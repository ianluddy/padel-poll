import { Resend } from "resend";
import { loadSessionPlayersMany } from "@/lib/state";
import { buildSessionKey } from "@/lib/sessions";

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

function getWhapiEnv(): {
  token: string | undefined;
  to: string | undefined;
  baseUrl: string;
} {
  return {
    token: process.env.WHAPI_TOKEN,
    to: process.env.WHAPI_TO,
    baseUrl: process.env.WHAPI_BASE_URL ?? "https://gate.whapi.cloud",
  };
}

function whapiRecipients(to: string): string[] {
  return to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatSlotDate(weekday: string, dateStr: string): string {
  const [dd, mm] = dateStr.split("/").map(Number);
  if (!dd || !mm || mm < 1 || mm > 12) return `${weekday} ${dateStr}`;
  return `${weekday} ${MONTH_NAMES[mm - 1]} ${dd}${ordinalSuffix(dd)}`;
}

async function sendWhapiText(
  baseUrl: string,
  token: string,
  to: string,
  body: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/messages/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`whapi ${res.status}: ${detail || res.statusText}`);
  }
}

export async function sendOpeningWhatsApp(
  openings: SlotOpening[],
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };

  const heading = openings.length === 1 ? `Slot open:` : `Slots open:`;

  const lines = openings
    .map(
      (o) =>
        `• ${formatSlotDate(o.weekday, o.date)} ${o.hour} - ${o.courts.join(", ")}`,
    )
    .join("\n");

  const body = `https://padel-poll.vercel.app/\n\n${heading}\n${lines}\n\nGive a 👍 if you want to play`;

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, body);
  }
  return { sent: true };
}

export type UpcomingSessionSummary = {
  weekday: string;
  date: string;
  startTime: string;
  court: string;
  venue: string;
  maxPlayers: number;
};

export async function sendUpcomingSessionsWhatsApp(
  sessions: UpcomingSessionSummary[],
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };
  if (sessions.length === 0) {
    return { sent: false, reason: "no upcoming sessions" };
  }

  const sessionKeys = sessions.map(buildSessionKey);
  const playerMap = await loadSessionPlayersMany(sessionKeys);

  const lines = sessions
    .map((s, i) => {
      const players = playerMap[sessionKeys[i]] ?? [];
      const slots: string[] = [];
      for (let i = 0; i < s.maxPlayers; i++) {
        slots.push(players[i] ?? "[Slot available]");
      }
      return `• ${formatSlotDate(s.weekday, s.date)} ${s.startTime} - ${s.court}\n   ${slots.join(", ")}`;
    })
    .join("\n");

  const body = `Upcoming sessions:\n${lines}`;

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, body);
  }
  return { sent: true };
}

export type CancellationReminder = {
  weekday: string;
  date: string;
  startTime: string;
  court: string;
  venue: string;
  hoursUntil: number;
  players: string[];
  maxPlayers: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playersTextLine(r: CancellationReminder): string {
  const count = r.players.length;
  const open = r.maxPlayers - count;
  if (count === 0) {
    return `Players: none yet (${r.maxPlayers} spots open)`;
  }
  const names = r.players.join(", ");
  if (open <= 0) return `Players: ${names}`;
  return `Players: ${names} (${count}/${r.maxPlayers} — ${open} spot${open === 1 ? "" : "s"} open)`;
}

export async function sendCancellationReminderEmail(
  reminders: CancellationReminder[],
): Promise<{ sent: boolean; reason?: string }> {
  const { apiKey, to, from } = getEnv();
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "EMAIL_TO not set" };

  const resend = new Resend(apiKey);
  const subject =
    reminders.length === 1
      ? `Cancel by 24h: ${reminders[0].weekday} ${reminders[0].date} ${reminders[0].startTime}`
      : `${reminders.length} bookings approaching 24h cancellation cutoff`;

  const rows = reminders
    .map((r) => {
      const count = r.players.length;
      const open = r.maxPlayers - count;
      const playersCell =
        count === 0
          ? `<em>none yet (${r.maxPlayers} spots open)</em>`
          : open > 0
            ? `${escapeHtml(r.players.join(", "))} <em>(${count}/${r.maxPlayers} — ${open} spot${open === 1 ? "" : "s"} open)</em>`
            : escapeHtml(r.players.join(", "));
      return `<tr><td>${escapeHtml(r.weekday)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.startTime)}</td><td>${escapeHtml(r.court)}</td><td>${escapeHtml(r.venue)}</td><td>${playersCell}</td></tr>`;
    })
    .join("");
  const html = `
    <p>The free cancellation window (24h) is closing soon for:</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <thead><tr><th>Day</th><th>Date</th><th>Time</th><th>Court</th><th>Venue</th><th>Players</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>If anyone can't make it, let the group know now so the booking can be cancelled for free.</p>
  `;
  const text = reminders
    .map(
      (r) =>
        `${r.weekday} ${r.date} ${r.startTime} — ${r.court} (${r.venue}) — ${playersTextLine(r)}`,
    )
    .join("\n");

  await resend.emails.send({ from, to, subject, html, text });
  return { sent: true };
}

export async function sendCancellationReminderWhatsApp(
  reminders: CancellationReminder[],
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };

  const heading =
    reminders.length === 1
      ? `Booking reminder:`
      : `Booking reminders:`;

  const lines = reminders
    .map((r) => {
      const slots: string[] = [];
      for (let i = 0; i < r.maxPlayers; i++) {
        slots.push(r.players[i] ?? "[Slot available]");
      }
      return `• ${formatSlotDate(r.weekday, r.date)} ${r.startTime} - ${r.court}\n   ${slots.join(", ")}`;
    })
    .join("\n");

  const body = `${heading}\n${lines}`;

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, body);
  }
  return { sent: true };
}

export type SessionChangeNotice = {
  weekday: string;
  date: string;
  startTime: string;
  court: string;
  venue: string;
  maxPlayers: number;
};

export async function sendSessionBookedWhatsApp(
  sessions: SessionChangeNotice[],
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };

  const sessionKeys = sessions.map(buildSessionKey);
  const playerMap = await loadSessionPlayersMany(sessionKeys);

  const heading = sessions.length === 1 ? "Session booked:" : "Sessions booked:";
  const lines = sessions
    .map((s, i) => {
      const players = playerMap[sessionKeys[i]] ?? [];
      const slots: string[] = [];
      for (let j = 0; j < s.maxPlayers; j++) {
        slots.push(players[j] ?? "[Slot available]");
      }
      return `• ${formatSlotDate(s.weekday, s.date)} ${s.startTime} - ${s.court}\n   ${slots.join(", ")}`;
    })
    .join("\n");

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, `${heading}\n${lines}`);
  }
  return { sent: true };
}

export type PlayerUpdateNotice = {
  playerName: string;
  action: "IN" | "OUT";
  weekday: string;
  date: string;
  startTime: string;
  court: string;
  players: string[];
  maxPlayers: number;
};

export async function sendPlayerUpdateWhatsApp(
  notice: PlayerUpdateNotice,
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };

  const slots: string[] = [];
  for (let i = 0; i < notice.maxPlayers; i++) {
    slots.push(notice.players[i] ?? "[Slot available]");
  }
  const body = `${notice.playerName} is ${notice.action}\n\n${formatSlotDate(notice.weekday, notice.date)} ${notice.startTime} - ${notice.court}\n${slots.join(", ")}`;

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, body);
  }
  return { sent: true };
}

export async function sendSessionCancelledWhatsApp(
  sessions: SessionChangeNotice[],
): Promise<{ sent: boolean; reason?: string }> {
  const { token, to, baseUrl } = getWhapiEnv();
  if (!token) return { sent: false, reason: "WHAPI_TOKEN not set" };
  if (!to) return { sent: false, reason: "WHAPI_TO not set" };

  const heading = sessions.length === 1 ? "Session cancelled:" : "Sessions cancelled:";
  const lines = sessions
    .map((s) => `• ${formatSlotDate(s.weekday, s.date)} ${s.startTime} - ${s.court}`)
    .join("\n");

  for (const recipient of whapiRecipients(to)) {
    await sendWhapiText(baseUrl, token, recipient, `${heading}\n${lines}`);
  }
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
