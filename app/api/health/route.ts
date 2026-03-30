// ============================================================
// app/api/health/route.ts
// Health check — tests all external API connections
// ============================================================

import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET() {
  const results: Record<string, { ok: boolean; detail: string }> = {};

  // ── 1. Env vars present ──────────────────────────────────────
  const envVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "TINYFISH_API_KEY",
  ];
  const missingEnv = envVars.filter((k) => !process.env[k]);
  results.env = {
    ok: missingEnv.length === 0,
    detail: missingEnv.length === 0
      ? "All env vars present"
      : `Missing: ${missingEnv.join(", ")}`,
  };

  // ── 2. Supabase — can we query the tasks table? ──────────────
  try {
    const db = getSupabaseClient();
    const { error } = await db.from("tasks").select("id").limit(1);
    results.supabase = {
      ok: !error,
      detail: error ? `${error.code}: ${error.message}` : "tasks table reachable",
    };
  } catch (e) {
    results.supabase = { ok: false, detail: String(e) };
  }

  // ── 3. OpenAI — can we get a response? ──────────────────────
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    const openai = new (await import("openai")).default({ apiKey });
    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 5,
    });
    const text = result.choices[0]?.message?.content?.trim() ?? "";
    results.openai = { ok: true, detail: `Response: "${text}"` };
  } catch (e) {
    results.openai = { ok: false, detail: String(e) };
  }

  // ── 4. TinyFish — is the API key set? ────────────────────────
  try {
    const key = process.env.TINYFISH_API_KEY;
    if (!key) throw new Error("TINYFISH_API_KEY not set");
    results.tinyfish = {
      ok: true,
      detail: `API key present (${key.slice(0, 12)}...)`,
    };
  } catch (e) {
    results.tinyfish = { ok: false, detail: String(e) };
  }

  const allOk = Object.values(results).every((r) => r.ok);

  return NextResponse.json(
    { status: allOk ? "healthy" : "degraded", checks: results },
    { status: allOk ? 200 : 207 }
  );
}
