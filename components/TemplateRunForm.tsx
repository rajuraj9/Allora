"use client";

import { useState } from "react";
import { Template, TemplateField } from "@/lib/templates";

interface TemplateRunFormProps {
  template: Template;
  onSubmit: (inputs: Record<string, string>) => void;
  onBack: () => void;
  loading?: boolean;
  token?: string;
}

function fieldHint(field: TemplateField): string | null {
  if (field.type === "url") {
    return "Enter a full URL starting with https://. Comma-separate multiple URLs.";
  }
  if (field.key === "product") return "e.g. iPhone 15 Pro 256GB — be specific for better results.";
  if (field.key === "tracking_number") return "Find this in your order confirmation email.";
  if (field.key === "message" || field.key === "data_description") return "Be specific — the more detail, the better the output.";
  return null;
}

export default function TemplateRunForm({ template, onSubmit, onBack, loading, token }: TemplateRunFormProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [aiHint, setAiHint] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    for (const field of template.fields) {
      if (field.required && !inputs[field.key]?.trim()) {
        newErrors[field.key] = `${field.label} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function normalizeInputs(raw: Record<string, string>): Record<string, string> {
    const fixed = { ...raw };
    for (const field of template.fields) {
      if (field.type === "url" && fixed[field.key]) {
        // Handle comma-separated URLs — take the first one for single-URL fields
        const urls = fixed[field.key].split(",").map((u) => u.trim()).filter(Boolean);
        const first = urls[0];
        if (first && !/^https?:\/\//i.test(first)) {
          fixed[field.key] = `https://${first}`;
        } else if (first) {
          fixed[field.key] = first;
        }
      }
    }
    return fixed;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeInputs(inputs);
    setInputs(normalized);
    if (validate()) onSubmit(normalized);
  }

  async function handleAISuggest() {
    if (!aiHint.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/template/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          hint: aiHint,
          fields: template.fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            placeholder: f.placeholder,
            options: f.options,
          })),
        }),
      });
      const data = await res.json();
      if (data.suggestions) {
        setInputs((prev) => {
          const merged = { ...prev };
          // Build a map of valid field keys for fast lookup
          const validKeys = new Set(template.fields.map((f) => f.key));

          for (const [k, v] of Object.entries(data.suggestions as Record<string, string>)) {
            if (!v) continue;

            // Skip keys that don't exist in this template's fields
            if (!validKeys.has(k)) continue;

            const field = template.fields.find((f) => f.key === k);

            if (field?.type === "select" && field.options) {
              const match = field.options.find(
                (o) => o.toLowerCase() === String(v).toLowerCase()
              );
              if (match) merged[k] = match;
            } else if (field?.type === "url" || k === "custom_url") {
              const val = String(v).trim();
              const userProvidedUrl = /https?:\/\//i.test(aiHint);
              const isPlaceholder = /example\.(com|org|net)|placeholder|your-site|yoursite/i.test(val);
              if (userProvidedUrl && !isPlaceholder && val.startsWith("http")) {
                merged[k] = val;
              }
            } else {
              merged[k] = String(v);
            }
          }

          // If source/sources is not "Custom URL", clear custom_url
          const sourceKey = template.fields.find((f) => f.key === "source" || f.key === "sources")?.key;
          if (sourceKey && merged[sourceKey] && !merged[sourceKey].toLowerCase().includes("custom")) {
            merged["custom_url"] = "";
          }

          return merged;
        });
        setAiUsed(true);
      }
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Back */}
      <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 mb-6 flex items-center gap-1 transition-colors">
        ← Back to templates
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">{template.icon}</span>
        <div>
          <h2 className="text-lg font-semibold text-white">{template.title}</h2>
          <p className="text-xs text-zinc-500">{template.description}</p>
        </div>
      </div>

      {/* AI Assist bar */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">✦</span>
          <span className="text-xs font-medium text-zinc-300">AI Fill</span>
          {aiUsed && <span className="text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">Fields filled</span>}
        </div>
        <p className="text-xs text-zinc-500 mb-3">Describe what you want and AI will fill the fields for you.</p>
        <div className="flex gap-2">
          <input
            value={aiHint}
            onChange={(e) => setAiHint(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAISuggest()}
            placeholder={`e.g. "${template.fields[0]?.placeholder ?? "describe your task"}"`}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <button
            onClick={handleAISuggest}
            disabled={aiLoading || !aiHint.trim()}
            className="bg-white text-zinc-900 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {aiLoading ? "Filling…" : "Fill ✦"}
          </button>
        </div>
      </div>

      {/* Fields */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {template.fields.map((field) => {
          const hint = fieldHint(field);
          return (
            <div key={field.key}>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {field.type === "select" && field.options ? (
                <select
                  value={inputs[field.key] ?? ""}
                  onChange={(e) => setInputs((p) => ({ ...p, [field.key]: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                >
                  <option value="" className="bg-zinc-900">Select…</option>
                  {field.options.map((o) => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}
                </select>
              ) : (
                <input
                  type={field.type === "email" ? "email" : "text"}
                  value={inputs[field.key] ?? ""}
                  onChange={(e) => setInputs((p) => ({ ...p, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              )}
              {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
              {errors[field.key] && <p className="text-xs text-red-400 mt-1">{errors[field.key]}</p>}
            </div>
          );
        })}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-white text-zinc-900 text-sm font-semibold py-3 rounded-xl hover:bg-zinc-100 disabled:opacity-50 transition-colors mt-2"
        >
          {loading ? "Starting…" : `Run — ${template.estimatedTime}`}
        </button>
      </form>

      {/* Expected output */}
      <div className="mt-5 rounded-xl bg-white/5 border border-white/10 p-4">
        <p className="text-xs text-zinc-500 font-medium mb-2">Expected output schema</p>
        <pre className="text-xs text-zinc-400 overflow-auto leading-relaxed">
          {JSON.stringify(template.expectedOutputSchema, null, 2)}
        </pre>
      </div>
    </div>
  );
}
