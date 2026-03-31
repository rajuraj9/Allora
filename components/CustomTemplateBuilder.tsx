"use client";

import { useState } from "react";

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "url" | "email" | "select";
  required: boolean;
  options: string; // comma-separated for select type
}

interface CustomTemplateBuilderProps {
  onBack: () => void;
  onCreated: () => void;
  token: string;
}

const FIELD_TYPES = ["text", "url", "email", "select"] as const;

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function CustomTemplateBuilder({ onBack, onCreated, token }: CustomTemplateBuilderProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — basic info
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Step 2 — fields
  const [fields, setFields] = useState<FieldDef[]>([
    { key: "url", label: "Target URL", placeholder: "https://example.com", type: "url", required: true, options: "" },
  ]);

  // Step 3 — prompt
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [error, setError] = useState("");

  // ── Field management ──────────────────────────────────────────

  function addField() {
    setFields((f) => [...f, { key: "", label: "", placeholder: "", type: "text", required: false, options: "" }]);
  }

  function removeField(i: number) {
    setFields((f) => f.filter((_, idx) => idx !== i));
  }

  function updateField(i: number, patch: Partial<FieldDef>) {
    setFields((f) => f.map((field, idx) => {
      if (idx !== i) return field;
      const updated = { ...field, ...patch };
      // Auto-generate key from label
      if (patch.label !== undefined && !field.key) {
        updated.key = slugify(patch.label);
      }
      return updated;
    }));
  }

  // ── Generate prompt with AI ───────────────────────────────────

  async function handleGeneratePrompt() {
    setGeneratingPrompt(true);
    try {
      const res = await fetch("/api/template/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          description,
          fields: fields.filter((f) => f.label).map((f) => ({
            key: f.key || slugify(f.label),
            label: f.label,
            type: f.type,
            required: f.required,
          })),
        }),
      });
      const data = await res.json();
      if (data.prompt) setPrompt(data.prompt);
    } finally {
      setGeneratingPrompt(false);
    }
  }

  // ── Save ──────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const parsedFields = fields
        .filter((f) => f.label.trim())
        .map((f) => ({
          key: f.key || slugify(f.label),
          label: f.label,
          placeholder: f.placeholder,
          type: f.type,
          required: f.required,
          options: f.type === "select" ? f.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
        }));

      const res = await fetch("/api/template/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, description, url: "", prompt, fields: parsedFields }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  // ── UI ────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto">
      <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 mb-6 flex items-center gap-1 transition-colors">
        ← Back to templates
      </button>

      <h2 className="text-lg font-semibold text-white mb-1">Create a Template</h2>
      <p className="text-xs text-zinc-500 mb-6">Build a reusable automation with custom input fields.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => { if (s < step || (s === 2 && title.trim())) setStep(s as 1 | 2 | 3); }}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                step === s ? "bg-white text-zinc-900" : step > s ? "bg-green-500 text-white" : "bg-white/10 text-zinc-500"
              }`}
            >
              {step > s ? "✓" : s}
            </button>
            {s < 3 && <div className={`h-px w-12 transition-colors ${step > s ? "bg-white" : "bg-white/10"}`} />}
          </div>
        ))}
        <span className="text-xs text-zinc-500 ml-2">
          {step === 1 ? "Basic info" : step === 2 ? "Input fields" : "Automation prompt"}
        </span>
      </div>

      {/* ── Step 1: Basic info ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Template Name *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Product Review Scraper"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this template do?"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
          </div>
          <button disabled={!title.trim()} onClick={() => setStep(2)}
            className="w-full bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">
            Next: Define Inputs →
          </button>
        </div>
      )}

      {/* ── Step 2: Input fields ── */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">Define what users need to fill in before running this template. These become the form fields.</p>

          <div className="space-y-3">
            {fields.map((field, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400">Field {i + 1}</span>
                  {fields.length > 1 && (
                    <button onClick={() => removeField(i)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Remove</button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Label *</label>
                    <input value={field.label}
                      onChange={(e) => updateField(i, { label: e.target.value, key: slugify(e.target.value) })}
                      placeholder="e.g. Company URL"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Type</label>
                    <select value={field.type} onChange={(e) => updateField(i, { type: e.target.value as FieldDef["type"] })}
                      className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20">
                      {FIELD_TYPES.map((t) => <option key={t} value={t} className="bg-zinc-900">{t}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Placeholder text</label>
                  <input value={field.placeholder} onChange={(e) => updateField(i, { placeholder: e.target.value })}
                    placeholder="e.g. https://example.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
                </div>

                {field.type === "select" && (
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Options (comma-separated)</label>
                    <input value={field.options} onChange={(e) => updateField(i, { options: e.target.value })}
                      placeholder="Option A, Option B, Option C"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateField(i, { required: !field.required })}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      field.required
                        ? "bg-white/10 border-white/20 text-white"
                        : "bg-transparent border-white/10 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full border flex-shrink-0 ${field.required ? "bg-white border-white" : "border-zinc-500"}`} />
                    Required
                  </button>
                  <span className="text-xs text-zinc-600">Field key: <code className="text-zinc-400">{field.key || slugify(field.label) || "…"}</code></span>
                </div>
              </div>
            ))}
          </div>

          <button onClick={addField}
            className="w-full border border-dashed border-white/20 text-zinc-400 hover:text-white hover:border-white/40 text-sm py-2.5 rounded-xl transition-colors">
            + Add Field
          </button>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(1)} className="flex-1 border border-white/10 text-zinc-400 text-sm py-2.5 rounded-lg hover:bg-white/5 transition-colors">← Back</button>
            <button onClick={() => setStep(3)} className="flex-1 bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 transition-colors">Next: Write Prompt →</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Prompt ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-xs font-semibold text-zinc-400 mb-2">Your fields — use these in the prompt with {`{{field_key}}`}</p>
            <div className="flex flex-wrap gap-2">
              {fields.filter((f) => f.label).map((f) => (
                <code key={f.key}
                  onClick={() => setPrompt((p) => p + `{{${f.key || slugify(f.label)}}}`)}
                  className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 px-2 py-1 rounded cursor-pointer hover:bg-zinc-700 transition-colors"
                  title="Click to insert">
                  {`{{${f.key || slugify(f.label)}}}`}
                </code>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-zinc-300">Automation Prompt *</label>
              <button
                onClick={handleGeneratePrompt}
                disabled={generatingPrompt}
                className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/15 border border-white/10 text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {generatingPrompt ? (
                  <><span className="animate-spin inline-block">⟳</span> Generating…</>
                ) : (
                  <>✦ Generate with AI</>
                )}
              </button>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8}
              placeholder={`Describe what to do. Use {{field_key}} to reference user inputs.\n\ne.g. Visit {{url}} and extract all product names, prices, and ratings. Return as JSON array with keys: name, price, rating.`}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none" />
            <p className="text-xs text-zinc-600 mt-1">{prompt.length}/2000 — Always ask for JSON output.</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 border border-white/10 text-zinc-400 text-sm py-2.5 rounded-lg hover:bg-white/5 transition-colors">← Back</button>
            <button disabled={!prompt.trim() || saving} onClick={handleSave}
              className="flex-1 bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
