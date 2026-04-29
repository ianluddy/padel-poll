import type { SlotOpening, CronFailure } from "./notify";

const BOOKING_URL = "https://projectpadel.ie/Booking/Grid.aspx";

type GreenApiConfig = {
  instanceId: string;
  token: string;
  chatId: string;
};

function getConfig(): GreenApiConfig | null {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  const chatId = process.env.GREEN_API_CHAT_ID;
  if (!instanceId || !token || !chatId) return null;
  return { instanceId, token, chatId };
}

async function sendMessage(
  cfg: GreenApiConfig,
  message: string,
): Promise<void> {
  const url = `https://api.green-api.com/waInstance${cfg.instanceId}/sendMessage/${cfg.token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: cfg.chatId, message }),
  });
  if (!res.ok) {
    throw new Error(`Green API ${res.status}: ${await res.text()}`);
  }
}

function formatOpenings(openings: SlotOpening[]): string {
  const header =
    openings.length === 1
      ? "*New padel slot open*"
      : `*${openings.length} new padel slots open*`;
  const lines = openings.map(
    (o) =>
      `• ${o.weekday} ${o.date} ${o.hour} — ${o.venue} (${o.courts.join(", ")})`,
  );
  return [header, "", ...lines, "", `Book: ${BOOKING_URL}`].join("\n");
}

function formatFailures(failures: CronFailure[]): string {
  const header = `*Padel Poll cron failed (${failures.length})*`;
  const lines = failures.map((f) => `• ${f.stage}: ${f.detail}`);
  return [header, "", ...lines].join("\n");
}

export async function sendOpeningWhatsApp(
  openings: SlotOpening[],
): Promise<{ sent: boolean; reason?: string }> {
  const cfg = getConfig();
  if (!cfg) return { sent: false, reason: "GREEN_API env vars not set" };
  try {
    await sendMessage(cfg, formatOpenings(openings));
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendFailureWhatsApp(
  failures: CronFailure[],
): Promise<{ sent: boolean; reason?: string }> {
  const cfg = getConfig();
  if (!cfg) return { sent: false, reason: "GREEN_API env vars not set" };
  try {
    await sendMessage(cfg, formatFailures(failures));
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
