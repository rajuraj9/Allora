"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import ExecutionView from "@/components/ExecutionView";
import { TEMPLATES, Template } from "@/lib/templates";
import TemplateRunForm from "@/components/TemplateRunForm";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

const EXAMPLE_PROMPTS = [
  "Find me Telugu movies playing in Bangalore tomorrow",
  "Best restaurants for a dinner date in Hyderabad tonight",
  "Track my Delhivery shipment 1234567890",
  "Compare iPhone 15 Pro prices on Amazon and Flipkart",
  "Find upcoming hackathons on Devfolio",
];

const FEATURED_TEMPLATES = TEMPLATES.slice(0, 6);

// ── Auth Modal ────────────────────────────────────────────────────
function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(""); setMessage("");
    const supabase = getSupabase();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else { setMessage("Check your email to confirm, then sign in."); setMode("login"); }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else onSuccess();
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-zinc-900 border border-white/10 rounded-2xl p-8 shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-500 hover:text-white text-lg">✕</button>
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm">✦</div>
            <span className="text-sm font-bold text-white">Allora AI</span>
          </div>
          <h2 className="text-white text-lg font-semibold">
            {mode === "signup" ? "Create your free account" : "Welcome back"}
          </h2>
          <p className="text-zinc-400 text-xs mt-1">
            {mode === "signup" ? "Start automating the web in seconds" : "Sign in to run your task"}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50" />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50" />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {message && <p className="text-green-400 text-xs">{message}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-50 transition-colors">
            {loading ? "Please wait…" : mode === "signup" ? "Sign Up Free" : "Sign In"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          {mode === "signup" ? "Already have an account?" : "No account?"}{" "}
          <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setMessage(""); }}
            className="text-white hover:underline font-medium">
            {mode === "signup" ? "Sign in" : "Sign up free"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
function HomeInner() {
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [taskId, setTaskId] = useState<string | null>(searchParams.get("task_id"));
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [pendingAction, setPendingAction] = useState<"task" | "template" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setTaskId(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLE_PROMPTS.length), 3000);
    return () => clearInterval(id);
  }, []);

  // After auth succeeds, resume the pending action
  function handleAuthSuccess() {
    setShowAuth(false);
    if (pendingAction === "task") runTask();
    if (pendingAction === "template") { /* template form is already shown */ }
    setPendingAction(null);
  }

  async function runTask() {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || !goal.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setTaskId(d.task_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim()) return;
    if (!session) { setPendingAction("task"); setShowAuth(true); return; }
    runTask();
  }

  function handleSelectTemplate(template: Template) {
    if (!session) {
      setSelectedTemplate(template); // store it
      setPendingAction("template");
      setShowAuth(true);
      return;
    }
    setSelectedTemplate(template);
  }

  async function handleRunTemplate(inputs: Record<string, string>) {
    if (!selectedTemplate || !session) return;
    setTemplateLoading(true);
    try {
      const res = await fetch("/api/template", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ template_id: selectedTemplate.id, inputs }),
      });
      const data = await res.json();
      if (res.ok && data.task_id) { setSelectedTemplate(null); setTaskId(data.task_id); }
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleUserResponse(fields: Record<string, string>) {
    if (!taskId || !session) return;
    await fetch(`/api/task/${taskId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task_id: taskId, fields }),
    });
  }

  async function handleConfirm(confirmed: boolean) {
    if (!taskId || !session) return;
    await fetch(`/api/task/${taskId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task_id: taskId, confirmed }),
    });
  }

  // Loading state
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Task execution view
  if (taskId) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <nav className="border-b border-zinc-200 bg-white px-6 py-3 flex items-center justify-between">
          <button onClick={() => setTaskId(null)} className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-zinc-900 flex items-center justify-center text-white text-xs">✦</div>
            <span className="text-sm font-semibold text-zinc-900">Allora AI</span>
          </button>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-800">Dashboard</a>
            <a href="/templates" className="text-xs text-zinc-500 hover:text-zinc-800">Templates</a>
          </div>
        </nav>
        <div className="max-w-2xl mx-auto px-4 py-10">
          <ExecutionView task_id={taskId} token={session!.access_token} onUserResponse={handleUserResponse} onConfirm={handleConfirm} />
          <button onClick={() => setTaskId(null)} className="mt-6 text-sm text-zinc-400 hover:text-zinc-700 flex items-center gap-1">← New task</button>
        </div>
      </div>
    );
  }

  // Template run form
  if (selectedTemplate && session) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
          <button onClick={() => setSelectedTemplate(null)} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm">✦</div>
            <span className="text-sm font-bold tracking-tight text-white">Allora AI</span>
          </button>
        </nav>
        <div className="max-w-lg mx-auto px-4 py-10">
          <TemplateRunForm template={selectedTemplate} onSubmit={handleRunTemplate} onBack={() => setSelectedTemplate(null)} loading={templateLoading} token={session.access_token} />
        </div>
      </div>
    );
  }

  // ── Landing page (visible to everyone) ───────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {showAuth && <AuthModal onClose={() => { setShowAuth(false); setPendingAction(null); }} onSuccess={handleAuthSuccess} />}

      {/* Nav */}
      <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm">✦</div>
          <span className="text-sm font-bold tracking-tight">Allora AI</span>
        </div>
        <div className="flex items-center gap-4">
          {session ? (
            <>
              <a href="/dashboard" className="text-xs text-zinc-400 hover:text-white transition-colors">Dashboard</a>
              <a href="/templates" className="text-xs text-zinc-400 hover:text-white transition-colors">All Templates</a>
              <button onClick={() => getSupabase().auth.signOut()} className="text-xs text-zinc-500 hover:text-white transition-colors">Sign out</button>
            </>
          ) : (
            <>
              <button onClick={() => setShowAuth(true)} className="text-xs text-zinc-400 hover:text-white transition-colors">Sign in</button>
              <button onClick={() => setShowAuth(true)} className="text-xs bg-white text-zinc-900 font-semibold px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors">Get started free</button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-3xl mx-auto px-4 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 text-xs text-zinc-400 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Real browser automation · Live streaming
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
          Tell it what you want.<br />
          <span className="text-zinc-400">Watch it happen.</span>
        </h1>
        <p className="text-zinc-400 text-base max-w-xl mx-auto mb-10">
          Allora AI opens a real browser and completes any web task for you — booking, research, tracking, scraping — while you watch live.
        </p>

        {/* Prompt input */}
        <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto">
          <div className="relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden focus-within:border-white/25 transition-colors">
            <textarea
              ref={textareaRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
              placeholder={EXAMPLE_PROMPTS[placeholderIdx]}
              rows={3}
              disabled={loading}
              className="w-full bg-transparent px-5 pt-4 pb-12 text-sm text-white placeholder-zinc-600 focus:outline-none resize-none disabled:opacity-50"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <span className="text-xs text-zinc-600">↵ to run</span>
              <button type="submit" disabled={loading || !goal.trim()}
                className="bg-white text-zinc-900 text-xs font-semibold px-4 py-2 rounded-lg hover:bg-zinc-100 disabled:opacity-40 transition-colors">
                {loading ? "Starting…" : "Run Task"}
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs mt-2 text-left">{error}</p>}
        </form>

        {/* Example chips */}
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {EXAMPLE_PROMPTS.slice(0, 4).map((p) => (
            <button key={p} onClick={() => { setGoal(p); textareaRef.current?.focus(); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 bg-white/5 hover:bg-white/10 border border-white/5 px-3 py-1.5 rounded-full transition-colors">
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Templates section */}
      <div className="max-w-4xl mx-auto px-4 pb-20">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-white">Quick Templates</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Pre-built automations — no prompt needed</p>
          </div>
          <a href="/templates" className="text-xs text-zinc-400 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 transition-colors">
            View all →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURED_TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => handleSelectTemplate(t)}
              className="group text-left bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-xl p-4 transition-all duration-150">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xl">{t.icon}</span>
                <span className="text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors">⏱ {t.estimatedTime}</span>
              </div>
              <h3 className="text-sm font-medium text-white mb-1">{t.title}</h3>
              <p className="text-xs text-zinc-500 line-clamp-2">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="border-t border-white/5 py-8">
        <div className="max-w-3xl mx-auto px-4 grid grid-cols-3 gap-4 text-center">
          {[
            { value: "10+", label: "Built-in templates" },
            { value: "< 60s", label: "Avg task time" },
            { value: "0", label: "Lines of code needed" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <HomeInner />
    </Suspense>
  );
}
