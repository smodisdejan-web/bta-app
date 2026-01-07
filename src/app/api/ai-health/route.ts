// src/app/api/ai-health/route.ts
export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.OPENAI_API_KEY || "";
  const masked = raw
    ? raw.length >= 8
      ? `${raw.slice(0, 4)}…${raw.slice(-4)}`
      : "set"
    : "";
  return Response.json({
    ok: Boolean(raw),
    envVar: "OPENAI_API_KEY",
    masked,
    now: new Date().toISOString(),
  });
}

