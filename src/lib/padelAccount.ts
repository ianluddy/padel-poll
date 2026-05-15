const BASE_URL = "https://projectpadel.ie";
const LOGIN_URL = `${BASE_URL}/Login.aspx`;
const INDEX_URL = `${BASE_URL}/Intranet/Index.aspx`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const USERNAME_FIELD = "ctl00$ContentPlaceHolderContenido$Login1$UserName";
const PASSWORD_FIELD = "ctl00$ContentPlaceHolderContenido$Login1$Password";
const SUBMIT_FIELD = "ctl00$ContentPlaceHolderContenido$Login1$LoginButton";

const HIDDEN_FIELDS = [
  "__EVENTTARGET",
  "__EVENTARGUMENT",
  "__VIEWSTATE",
  "__VIEWSTATEGENERATOR",
  "__EVENTVALIDATION",
] as const;

export type UserSession = {
  date: string;
  startTime: string;
  endTime: string;
  court: string;
  venue: string;
  bookingUrl?: string;
};

export class PadelAccountError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
  ) {
    super(message);
    this.name = "PadelAccountError";
  }
}

type CookieJar = Map<string, string>;

function mergeSetCookies(jar: CookieJar, res: Response): void {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "" || value.toLowerCase() === "deleted") {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HIDDEN_FIELDS) {
    const escaped = name.replace(/\$/g, "\\$");
    const re = new RegExp(
      `<input[^>]*name="${escaped}"[^>]*value="([^"]*)"`,
      "i",
    );
    const altRe = new RegExp(
      `<input[^>]*value="([^"]*)"[^>]*name="${escaped}"`,
      "i",
    );
    const m = html.match(re) ?? html.match(altRe);
    out[name] = m ? decodeHtmlAttr(m[1]) : "";
  }
  return out;
}

function decodeHtmlAttr(v: string): string {
  return v
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function login(
  username: string,
  password: string,
  jar: CookieJar,
): Promise<void> {
  const getRes = await fetch(LOGIN_URL, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
    redirect: "manual",
  });
  if (getRes.status >= 400) {
    throw new PadelAccountError(
      `Login GET failed: ${getRes.status}`,
      "login-get",
    );
  }
  mergeSetCookies(jar, getRes);
  const loginHtml = await getRes.text();
  const hidden = extractHiddenFields(loginHtml);
  if (!hidden.__VIEWSTATE || !hidden.__EVENTVALIDATION) {
    throw new PadelAccountError(
      "Could not extract __VIEWSTATE/__EVENTVALIDATION from login page",
      "login-parse",
    );
  }

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) body.set(k, v);
  body.set(USERNAME_FIELD, username);
  body.set(PASSWORD_FIELD, password);
  body.set(SUBMIT_FIELD, "Sign in");

  const postRes = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: LOGIN_URL,
      Origin: BASE_URL,
    },
    body: body.toString(),
    cache: "no-store",
    redirect: "manual",
  });
  mergeSetCookies(jar, postRes);

  if (postRes.status >= 500) {
    throw new PadelAccountError(
      `Login POST failed: ${postRes.status}`,
      "login-post",
    );
  }

  const looksAuthenticated =
    jar.has(".ASPXAUTH") ||
    Array.from(jar.keys()).some((k) => k.toLowerCase().includes("aspxauth"));
  if (!looksAuthenticated) {
    if (postRes.status === 302) {
      const location = postRes.headers.get("location") ?? "";
      if (location.toLowerCase().includes("login")) {
        throw new PadelAccountError(
          "Login rejected (redirected back to login)",
          "login-rejected",
        );
      }
      return;
    }
    throw new PadelAccountError(
      "Login did not set an auth cookie",
      "login-rejected",
    );
  }
}

async function fetchIndex(jar: CookieJar): Promise<string> {
  const res = await fetch(INDEX_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookieHeader(jar),
      Referer: BASE_URL,
    },
    cache: "no-store",
    redirect: "manual",
  });
  mergeSetCookies(jar, res);

  if (res.status === 302) {
    const location = res.headers.get("location") ?? "";
    if (location.toLowerCase().includes("login")) {
      throw new PadelAccountError(
        "Intranet redirected to login — session not authenticated",
        "index-redirect",
      );
    }
  }
  if (!res.ok && res.status !== 302) {
    throw new PadelAccountError(
      `Intranet GET failed: ${res.status}`,
      "index-fetch",
    );
  }
  return res.text();
}

function findNextActivitiesBlock(html: string): string | null {
  const lower = html.toLowerCase();
  const heading = lower.indexOf("next activities");
  if (heading === -1) return null;
  const tail = html.slice(heading);
  const endHeading = tail.search(/<h[1-6][^>]*>(?!.*next activities)/i);
  return endHeading > 0 ? tail.slice(0, endHeading) : tail.slice(0, 8000);
}

function getAttr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? decodeHtmlAttr(m[1]) : "";
}

function timePart(value: string): string {
  const parts = value.split(/\s+/);
  const time = parts.length > 1 ? parts[1] : parts[0];
  return time.slice(0, 5);
}

export function parseNextActivities(html: string): UserSession[] {
  const block = findNextActivitiesBlock(html);
  if (!block) return [];

  const sessions: UserSession[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*\bclass="TextoLinkBlanco"[^>]*>/gi;
  for (const m of block.matchAll(anchorRe)) {
    const tag = m[0];
    const fechainicio = getAttr(tag, "fechainicio");
    const horainicio = getAttr(tag, "horainicio");
    const horafin = getAttr(tag, "horafin");
    if (!fechainicio || !horainicio) continue;

    const date = fechainicio.split(/\s+/)[0] ?? "";
    const startTime = timePart(horainicio);
    const endTime = horafin ? timePart(horafin) : "";
    const recurso = getAttr(tag, "recurso");
    const centro = getAttr(tag, "centro");
    const courtMatch = recurso.match(/^(Court\s+\d+)/i);
    const court = courtMatch ? courtMatch[1] : recurso;
    const href = getAttr(tag, "href");
    let bookingUrl: string | undefined;
    if (href) {
      try {
        bookingUrl = new URL(href, `${BASE_URL}/Intranet/`).toString();
      } catch {
        bookingUrl = undefined;
      }
    }

    const key = `${date}|${startTime}|${endTime}|${court}|${centro}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({
      date,
      startTime,
      endTime,
      court,
      venue: centro,
      bookingUrl,
    });
  }
  return sessions;
}

export async function fetchUpcomingSessions(): Promise<{
  sessions: UserSession[];
  rawSnippet?: string;
}> {
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;
  if (!username || !password) {
    throw new PadelAccountError(
      "USERNAME / PASSWORD env vars not set",
      "config",
    );
  }

  const jar: CookieJar = new Map();
  await login(username, password, jar);
  const indexHtml = await fetchIndex(jar);

  const sessions = parseNextActivities(indexHtml);
  if (sessions.length === 0) {
    const snippet = findNextActivitiesBlock(indexHtml);
    return {
      sessions,
      rawSnippet: snippet ? snippet.slice(0, 2000) : undefined,
    };
  }
  return { sessions };
}
