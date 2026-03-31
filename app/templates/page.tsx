"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { TEMPLATES, TEMPLATE_CATEGORIES, Template } from "@/lib/templates";
import TemplateCard from "@/components/TemplateCard";
import TemplateRunForm from "@/components/TemplateRunForm";
import CustomTemplateBuilder from "@/components/CustomTemplateBuilder";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

interface CustomTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
  fields: Array<{ key: string; label: string; placeholder: string; type: string; required: boolean; options?: string[] }>;
  created_at: string;
}

// Convert a custom template to the Template interface shape
function toTemplate(ct: CustomTemplate): Template & { isCustom: true } {
  return {
    id: `custom_${ct.id}`,
    title: ct.title,
    description: ct.description || "Custom automation template",
    category: "Utility",
    icon: "⚙️",
    estimatedTime: "~60s",
    isCustom: true,
    fields: ct.fields.map((f) => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder || "",
      required: f.required,
      type: (f.type as "text" | "url" | "email" | "select") || "text",
      options: f.options,
    })),
    buildGoal: (inputs: Record<string, string>) => {
      // Replace {{field_key}} placeholders with actual values
      let goal = ct.prompt;
      for (const [k, v] of Object.entries(inputs)) {
        goal = goal.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
      }
      // Use url field as starting URL if present
      const url = inputs.url || inputs.website || inputs.link || "https://www.google.com";
      return { url, goal };
    },
    expectedOutputSchema: { result: "JSON object or array" },
  };
}

type View = "hub" | "run" | "build";
const ALL_CATEGORIES = ["All", "Mine", ...TEMPLATE_CATEGORIES.filter((c) => c !== "All")] as const;

export default function TemplateHub() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<View>("hub");
  const [selected, setSelected] = useState<Template | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("allora_recent_templates") ?? "[]");
    setRecentIds(stored);
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) fetchCustomTemplates(data.session.access_token);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  async function fetchCustomTemplates(token: string) {
    try {
      const res = await fetch("/api/template/custom", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCustomTemplates(data.templates ?? []);
      }
    } catch { /* ignore */ }
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }
  if (!session) { router.push("/"); return null; }

  const customAsTemplates = customTemplates.map(toTemplate);
  const allTemplates = [...TEMPLATES, ...customAsTemplates];

  function handleSelectTemplate(template: Template) {
    setSelected(template);
    setView("run");
    const recent = JSON.parse(localStorage.getItem("allora_recent_templates") ?? "[]") as string[];
    const updated = [template.id, ...recent.filter((id) => id !== template.id)].slice(0, 5);
    localStorage.setItem("allora_recent_templates", JSON.stringify(updated));
    setRecentIds(updated);
  }

  async function handleRunTemplate(inputs: Record<string, string>) {
    if (!selected) return;
    setLoading(true);
    try {
      // Custom templates run via the regular task API with the built goal
      const isCustom = selected.id.startsWith("custom_");
      const endpoint = isCustom ? "/api/task" : "/api/template";
      const body = isCustom
        ? { goal: selected.buildGoal(inputs).goal }
        : { template_id: selected.id, inputs };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.task_id) {
        router.push(`/?task_id=${data.task_id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  const filtered = allTemplates.filter((t) => {
    const isCustom = t.id.startsWith("custom_");
    if (category === "Mine") return isCustom;
    if (category !== "All" && !isCustom && t.category !== category) return false;
    if (category !== "All" && isCustom && category !== "Mine") return false;
    if (search) return t.title.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const recentTemplates = allTemplates.filter((t) => recentIds.includes(t.id));

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm">✦</div>
            <span className="text-sm font-bold tracking-tight">Allora AI</span>
          </button>
          <span className="text-zinc-600">/</span>
          <span className="text-sm text-zinc-400">Templates</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-xs text-zinc-400 hover:text-white transition-colors">Dashboard</a>
          <button onClick={() => router.push("/")} className="text-xs bg-white text-zinc-900 font-semibold px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
            + New Task
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-10">
        {view === "hub" && (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">Template Hub</h1>
              <p className="text-zinc-500 text-sm mt-1">Pre-built automations. Fill in the details and run — no prompt needed.</p>
            </div>

            {/* Search + create */}
            <div className="flex items-center gap-3 mb-6">
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20" />
              <button onClick={() => setView("build")}
                className="bg-white text-zinc-900 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-zinc-100 transition-colors whitespace-nowrap">
                + Create
              </button>
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
              {ALL_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    category === cat ? "bg-white text-zinc-900" : "bg-white/5 border border-white/10 text-zinc-400 hover:text-white"
                  }`}>
                  {cat === "Mine" && <span className="text-purple-400">⚙</span>}
                  {cat}
                  {cat === "Mine" && customTemplates.length > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${category === "Mine" ? "bg-zinc-800 text-zinc-400" : "bg-purple-500/20 text-purple-400"}`}>
                      {customTemplates.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Recently used */}
            {recentTemplates.length > 0 && category === "All" && !search && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Recently Used</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recentTemplates.slice(0, 2).map((t) => (
                    <TemplateCard key={t.id} template={t} onSelect={handleSelectTemplate} isRecent />
                  ))}
                </div>
              </div>
            )}

            {/* My Templates section */}
            {category === "All" && !search && customTemplates.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  My Templates
                  <span className="bg-purple-500/20 text-purple-400 text-xs px-1.5 py-0.5 rounded-full">{customTemplates.length}</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {customAsTemplates.map((t) => (
                    <TemplateCard key={t.id} template={t} onSelect={handleSelectTemplate} isCustom />
                  ))}
                </div>
              </div>
            )}

            {/* Grid */}
            {filtered.length > 0 ? (
              <>
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  {category === "Mine" ? "My Templates" : category === "All" ? "All Templates" : category} · {filtered.length}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtered.map((t) => (
                    <TemplateCard key={t.id} template={t} onSelect={handleSelectTemplate}
                      isCustom={t.id.startsWith("custom_")} />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-20">
                <p className="text-4xl mb-4">{category === "Mine" ? "⚙️" : "🔍"}</p>
                <p className="text-zinc-400 font-medium">
                  {category === "Mine" ? "No custom templates yet" : "No templates found"}
                </p>
                <p className="text-zinc-600 text-sm mt-1">
                  {category === "Mine" ? "Create your first template" : "Try a different search or create your own"}
                </p>
                <button onClick={() => setView("build")} className="mt-4 text-sm text-white underline">
                  Create a template
                </button>
              </div>
            )}
          </>
        )}

        {view === "run" && selected && (
          <TemplateRunForm template={selected} onSubmit={handleRunTemplate} onBack={() => setView("hub")}
            loading={loading} token={session.access_token} />
        )}

        {view === "build" && (
          <CustomTemplateBuilder onBack={() => setView("hub")}
            onCreated={() => {
              fetchCustomTemplates(session.access_token);
              setView("hub");
              setCategory("Mine");
            }}
            token={session.access_token} />
        )}
      </div>
    </div>
  );
}
