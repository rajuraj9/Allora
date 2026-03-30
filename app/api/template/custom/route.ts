// ============================================================
// app/api/template/custom/route.ts
// GET/POST /api/template/custom — user-created templates
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

const BLOCKED_PATTERNS = [
  /password/i, /credit.?card/i, /cvv/i, /otp/i, /login/i,
  /bank/i, /payment/i, /ssn/i, /passport/i,
];

function validatePrompt(prompt: string): string | null {
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(prompt)) return `Prompt contains restricted content: "${p.source}"`;
  }
  if (prompt.length < 20) return "Prompt too short — be more specific";
  if (prompt.length > 2000) return "Prompt too long — keep under 2000 characters";
  return null;
}

export async function GET(request: Request) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseClient();
  const { data } = await db.from("custom_templates")
    .select("*")
    .eq("user_id", auth.user_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, description, url, prompt, fields } = body as {
    title?: string;
    description?: string;
    url?: string;
    prompt?: string;
    fields?: Array<{ key: string; label: string; required: boolean }>;
  };

  if (!title?.trim()) return NextResponse.json({ error: "Title required" }, { status: 400 });
  if (!url?.trim()) return NextResponse.json({ error: "Starting URL required" }, { status: 400 });
  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt required" }, { status: 400 });

  const validationError = validatePrompt(prompt);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const db = getSupabaseClient();
  const { data, error } = await db.from("custom_templates").insert({
    user_id: auth.user_id,
    title: title.trim(),
    description: description?.trim() ?? "",
    url: url.trim(),
    prompt: prompt.trim(),
    fields: fields ?? [],
    created_at: new Date().toISOString(),
  }).select("id").single();

  if (error) return NextResponse.json({ error: "Failed to save template" }, { status: 500 });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
