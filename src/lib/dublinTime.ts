export function parseDublinLocalToUtc(date: string, time: string): Date | null {
  const [dd, mm, yyyy] = date.split("/").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  if (!dd || !mm || !yyyy || Number.isNaN(hh) || Number.isNaN(mi)) return null;
  const asIfUtc = Date.UTC(yyyy, mm - 1, dd, hh, mi);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(asIfUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const dublinAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
  );
  const offset = dublinAsUtc - asIfUtc;
  return new Date(asIfUtc - offset);
}
