import { NextResponse } from "next/server";
import { isStateConfigured } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const candidates = Object.keys(process.env).filter((k) =>
    /redis|kv|upstash|storage/i.test(k),
  );

  const checked = {
    UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
  };

  return NextResponse.json({
    stateConfigured: isStateConfigured(),
    expectedVars: checked,
    matchingEnvVarNames: candidates,
  });
}
