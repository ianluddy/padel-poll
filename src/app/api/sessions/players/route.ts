import { NextResponse } from "next/server";
import { MAX_PLAYERS, PLAYERS, isKnownPlayer } from "@/lib/players";
import { saveSessionPlayers } from "@/lib/state";

export const dynamic = "force-dynamic";

const MAX_SESSION_KEY_LENGTH = 200;

type Body = {
  sessionKey?: unknown;
  players?: unknown;
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("invalid JSON body");
  }

  const sessionKey = body.sessionKey;
  if (typeof sessionKey !== "string" || sessionKey.length === 0) {
    return badRequest("sessionKey is required");
  }
  if (sessionKey.length > MAX_SESSION_KEY_LENGTH) {
    return badRequest("sessionKey too long");
  }
  if (sessionKey.split("|").length !== 4) {
    return badRequest("sessionKey is malformed");
  }

  if (!Array.isArray(body.players)) {
    return badRequest("players must be an array");
  }
  if (body.players.length > MAX_PLAYERS) {
    return badRequest(`at most ${MAX_PLAYERS} players allowed`);
  }

  const players: string[] = [];
  for (const p of body.players) {
    if (typeof p !== "string") return badRequest("players must be strings");
    if (!isKnownPlayer(p)) return badRequest(`unknown player: ${p}`);
    if (players.includes(p)) return badRequest(`duplicate player: ${p}`);
    players.push(p);
  }

  const sorted = [...PLAYERS].filter((name) => players.includes(name));

  const saved = await saveSessionPlayers(sessionKey, sorted);
  return NextResponse.json({
    ok: true,
    players: saved.players,
    updatedAt: saved.updatedAt,
  });
}
