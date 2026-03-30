"use client";

import { useState } from "react";

interface CustomTemplateBuilderProps {
  onBack: () => void;
  onCreated: () => void;
  token: string;
}

export default function CustomTemplateBuilder({ onBack, onCreated, token }: CustomTemplateBuilderProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/template/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, description, url, prompt, fields: [] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 transition-colors">
        ← Back to templates
      </button>

      <h2 className="text-lg font-semibold text-white mb-1">Create a Template</h2>
      <p className="text-xs text-zinc-500 mb-6">Build a reusable automation for any public website.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${step >= s ? "bg-white text-zinc-900" : "bg-white/10 text-zinc-500"}`}>
              {s}
            </div>
            {s < 3 && <div className={`h-px w-8 ${step > s ? "bg-white" : "bg-white/10"}`} />}
          </div>
        ))}
        <span className="text-xs text-zinc-500 ml-2">
          {step === 1 ? "Basic info" : step === 2 ? "Target URL" : "Write prompt"}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Template Name *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Product Review Scraper" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this template do?" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
          </div>
          <button disabled={!title.trim()} onClick={() => setStep(2)} className="w-full bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">
            Next →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Starting URL *</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/page-to-automate" type="url" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
            <p className="text-xs text-zinc-600 mt-1">Must be a public page — no login required.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 border border-white/10 text-zinc-400 text-sm py-2.5 rounded-lg hover:bg-white/5 transition-colors">← Back</button>
            <button disabled={!url.trim()} onClick={() => setStep(3)} className="flex-1 bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Automation Prompt *</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="Describe exactly what to do on the page. e.g. 'Extract all product names, prices, and ratings. Return as a JSON array with keys: name, price, rating.'"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
            />
            <p className="text-xs text-zinc-600 mt-1">{prompt.length}/2000 — Be specific. Always ask for JSON output.</p>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 border border-white/10 text-zinc-400 text-sm py-2.5 rounded-lg hover:bg-white/5 transition-colors">← Back</button>
            <button disabled={!prompt.trim() || saving} onClick={handleSave} className="flex-1 bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
