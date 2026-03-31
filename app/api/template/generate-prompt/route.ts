// ============================================================
// app/api/template/generate-prompt/route.ts
// POST — generate an automation prompt from title + fields using GPT
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import OpenAI from "openai";

export async function POST(request: Request) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, description, fields } = await request.json() as {
    title: string;
    description?: string;
    fields: Array<{ key: string; label: string; type: string; required: boolean }>;
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });

  const client = new OpenAI({ apiKey });

  const fieldList = fields.map((f) =>
    `- {{${f.key}}} — ${f.label} (${f.type}, ${f.required ? "required" : "optional"})`
  ).join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You are an expert at writing browser automation prompts for an AI web agent. 
Write clear, specific, step-by-step instructions for what the browser agent should do.
Rules:
- Use {{field_key}} placeholders exactly as provided to reference user inputs
- Always end with "Return results as JSON" with specific key names
- Be specific about what to extract or do
- Keep it under 300 words
- Do NOT include markdown, just plain text instructions`,
      },
      {
        role: "user",
        content: `Write an automation prompt for a template called "${title}"${description ? ` — ${description}` : ""}.

Available input fields (use these as {{placeholders}}):
${fieldList}

Write the prompt that tells the browser agent exactly what to do using these inputs.`,
      },
    ],
  });

  const prompt = response.choices[0]?.message?.content?.trim() ?? "";
  return NextResponse.json({ prompt });
}
