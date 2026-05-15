import { NextResponse } from "next/server";
import {
  fetchUpcomingSessions,
  PadelAccountError,
} from "@/lib/padelAccount";
import { saveUserSessions, isStateConfigured } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  try {
    const { sessions, rawSnippet } = await fetchUpcomingSessions();
    await saveUserSessions({ checkedAt, sessions });
    const summary = {
      ok: true,
      checkedAt,
      count: sessions.length,
      stateConfigured: isStateConfigured(),
      ...(rawSnippet ? { rawSnippet } : {}),
    };
    console.log("[padel-poll:sessions]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const stage = err instanceof PadelAccountError ? err.stage : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    const status = stage === "login-rejected" || stage === "config" ? 401 : 500;
    const summary = { ok: false, checkedAt, stage, message };
    console.error("[padel-poll:sessions]", JSON.stringify(summary));
    return NextResponse.json(summary, { status });
  }
}
