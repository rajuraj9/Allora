// ============================================================
// app/api/template/suggest/route.ts
// POST /api/template/suggest — AI fills template fields from a natural language hint
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import OpenAI from "openai";

export async function POST(request: Request) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { hint, fields } = await request.json() as {
    hint: string;
    fields: Array<{ key: string; label: string; type: string; placeholder: string; options?: string[] }>;
  };

  if (!hint?.trim() || !fields?.length) {
    return NextResponse.json({ error: "hint and fields required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });

  const client = new OpenAI({ apiKey });

  const fieldList = fields.map((f) => {
    const optionsStr = f.options?.length
      ? ` (valid options ONLY: ${f.options.join(" | ")} — pick the most relevant one, avoid "Custom URL" unless no other option fits)`
      : "";
    return `- key="${f.key}" label="${f.label}" type=${f.type}${optionsStr} placeholder="${f.placeholder}"`;
  }).join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that fills in form fields based on a user's natural language description.

Rules:
- Return ONLY a valid JSON object with field keys as keys and suggested values as strings.
- For select fields, you MUST return one of the exact valid options listed — do not invent values.
- Prefer specific known options over generic ones (e.g. prefer "Devfolio" over "Custom URL" for hackathons).
- NEVER invent or guess URLs. Only fill URL fields if the user explicitly provides a URL in their description.
- If a field called "custom_url" exists and the source is not "Custom URL", leave custom_url empty.
- For filter fields: extract only the topic/keyword from the user's description (e.g. "AI", "Web3", "machine learning"). Do not put the platform name or location in the filter.
- If you cannot determine a value with confidence, use an empty string.
- Never invent sensitive data like passwords, payment info, or personal details.`,
      },
      {
        role: "user",
        content: `User description: "${hint}"

Fields to fill (use the exact key names in your JSON response):
${fieldList}

Important:
- Use the exact key names shown above (e.g. "sources" not "source").
- For select fields, pick the most appropriate option from the valid options list.
- For filter fields, extract only the topic keyword (e.g. "AI" not "AI based hackathons in india").
- Do NOT fill custom_url unless the user explicitly provided a URL.
- Return a JSON object with field keys and values.`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    const suggestions = JSON.parse(cleaned) as Record<string, string>;
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: {} });
  }
}
