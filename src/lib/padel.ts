const BASE_URL = "https://projectpadel.ie";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const VENUES = {
  galway: { id: 4, name: "Project Padel Galway" },
} as const;

export type VenueKey = keyof typeof VENUES;

type Session = { key: string; cookie: string };

type Occupation = {
  Tipo: string;
  StrHoraInicio: string;
  StrHoraFin: string;
  Minutos: number;
};

type Court = {
  Id: string;
  TextoPrincipal: string;
  Ocupaciones: Occupation[];
};

type GridResponse = {
  d: {
    Id: number;
    Nombre: string;
    StrFecha: string;
    StrHoraInicio: string;
    StrHoraFin: string;
    Columnas: Court[];
  };
};

export type CourtSlot = {
  courtId: string;
  courtName: string;
  available: boolean;
};

export type DaySlot = {
  date: string;
  weekday: string;
  hour: string;
  courts: CourtSlot[];
  anyAvailable: boolean;
};

export type FetchError = {
  date: string;
  message: string;
};

export type VenueAvailability = {
  venue: string;
  venueId: number;
  hour: string;
  days: DaySlot[];
  errors: FetchError[];
};

async function getSession(venueId: number): Promise<Session> {
  const res = await fetch(`${BASE_URL}/Booking/Grid.aspx?id=${venueId}`, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Grid page failed: ${res.status}`);

  const html = await res.text();
  const match = html.match(/hl90njda2b89k\s*=\s*'([^']+)'/);
  if (!match) throw new Error("Could not extract session key from grid page");

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  return { key: match[1], cookie };
}

async function fetchGrid(
  venueId: number,
  dateStr: string,
  session: Session,
): Promise<GridResponse["d"]> {
  const res = await fetch(`${BASE_URL}/booking/srvc.aspx/ObtenerCuadro`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/Booking/Grid.aspx?id=${venueId}`,
      Cookie: session.cookie,
    },
    body: JSON.stringify({
      idCuadro: venueId,
      fecha: dateStr,
      key: session.key,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Grid fetch failed: ${res.status}`);

  const json = (await res.json()) as GridResponse;
  return json.d;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isCourtFreeAt(court: Court, slotStart: number, slotEnd: number): boolean {
  return !court.Ocupaciones.some((occ) => {
    const occStart = toMinutes(occ.StrHoraInicio);
    const occEnd = toMinutes(occ.StrHoraFin);
    return occStart < slotEnd && occEnd > slotStart;
  });
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function nextWeekdays(days: number, fromDate = new Date()): Date[] {
  const result: Date[] = [];
  const start = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
  );
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    if (dow >= 1 && dow <= 4) result.push(d);
  }
  return result;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export async function getAvailability(
  venueKey: VenueKey,
  options: { hour?: number; days?: number; durationMinutes?: number } = {},
): Promise<VenueAvailability> {
  const { hour = 20, days: daysAhead = 21, durationMinutes = 60 } = options;
  const venue = VENUES[venueKey];
  const session = await getSession(venue.id);

  const targetDates = nextWeekdays(daysAhead);
  const slotStart = hour * 60;
  const slotEnd = slotStart + durationMinutes;
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;

  const settled = await Promise.allSettled(
    targetDates.map(async (date): Promise<DaySlot> => {
      const dateStr = formatDate(date);
      const grid = await fetchGrid(venue.id, dateStr, session);
      const courts: CourtSlot[] = grid.Columnas.map((court) => ({
        courtId: court.Id,
        courtName: court.TextoPrincipal,
        available: isCourtFreeAt(court, slotStart, slotEnd),
      }));
      return {
        date: dateStr,
        weekday: WEEKDAY_NAMES[date.getDay()],
        hour: hourLabel,
        courts,
        anyAvailable: courts.some((c) => c.available),
      };
    }),
  );

  const days: DaySlot[] = [];
  const errors: FetchError[] = [];
  settled.forEach((res, idx) => {
    if (res.status === "fulfilled") {
      days.push(res.value);
    } else {
      errors.push({
        date: formatDate(targetDates[idx]),
        message:
          res.reason instanceof Error
            ? res.reason.message
            : String(res.reason),
      });
    }
  });

  return {
    venue: venue.name,
    venueId: venue.id,
    hour: hourLabel,
    days,
    errors,
  };
}
