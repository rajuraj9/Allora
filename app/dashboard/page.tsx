"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

interface TaskRecord {
  id: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  created_at: string;
  updated_at: string;
  result?: { summary?: string };
  failure_reason?: string;
}

const statusConfig = {
  pending:   { label: "Pending",   dot: "bg-zinc-400",  badge: "bg-zinc-100 text-zinc-600" },
  running:   { label: "Running",   dot: "bg-blue-400 animate-pulse", badge: "bg-blue-50 text-blue-700" },
  completed: { label: "Completed", dot: "bg-green-400", badge: "bg-green-50 text-green-700" },
  failed:    { label: "Failed",    dot: "bg-red-400",   badge: "bg-red-50 text-red-700" },
  paused:    { label: "Paused",    dot: "bg-amber-400", badge: "bg-amber-50 text-amber-700" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadTasks(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) router.push("/");
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadTasks(s: Session) {
    setLoading(true);
    const supabase = getSupabase();
    const { data } = await supabase
      .from("tasks")
      .select("id, goal, status, created_at, updated_at, result, failure_reason")
      .eq("user_id", s.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setTasks((data ?? []) as TaskRecord[]);
    setLoading(false);
  }

  async function cancelTask(task_id: string) {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`/api/task/${task_id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setTasks((prev) => prev.map((t) => t.id === task_id
      ? { ...t, status: "failed" as const, failure_reason: "Cancelled by user" }
      : t
    ));
  }

  async function cancelAllStuck() {
    const stuck = tasks.filter((t) => t.status === "running" || t.status === "pending");
    await Promise.all(stuck.map((t) => cancelTask(t.id)));
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }
  if (!session) { router.push("/"); return null; }

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    running: tasks.filter((t) => t.status === "running").length,
  };

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
          <span className="text-sm text-zinc-400">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/templates" className="text-xs text-zinc-400 hover:text-white transition-colors">Templates</a>
          <button onClick={() => router.push("/")} className="text-xs bg-white text-zinc-900 font-semibold px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
            + New Task
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Your Tasks</h1>
          <p className="text-zinc-500 text-sm mt-1">{session!.user.email}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Total Tasks", value: stats.total, color: "text-white" },
            { label: "Completed", value: stats.completed, color: "text-green-400" },
            { label: "Failed", value: stats.failed, color: "text-red-400" },
            { label: "Running", value: stats.running, color: "text-blue-400" },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
          {["all", "running", "completed", "failed", "paused"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors capitalize ${
                filter === f
                  ? "bg-white text-zinc-900"
                  : "bg-white/5 border border-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {f === "all" ? `All (${tasks.length})` : `${f} (${tasks.filter((t) => t.status === f).length})`}
            </button>
          ))}
          {stats.running > 0 && (
            <button
              onClick={cancelAllStuck}
              className="ml-auto text-xs font-medium text-red-400 border border-red-400/20 bg-red-400/10 hover:bg-red-400/20 px-3 py-1.5 rounded-full whitespace-nowrap transition-colors"
            >
              ⏹ Stop all running ({stats.running})
            </button>
          )}
        </div>

        {/* Task list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-2/3 mb-2" />
                <div className="h-3 bg-white/5 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">🤖</p>
            <p className="text-zinc-400 font-medium">No tasks yet</p>
            <p className="text-zinc-600 text-sm mt-1">Run your first task from the home page</p>
            <button onClick={() => router.push("/")} className="mt-4 text-sm bg-white text-zinc-900 font-semibold px-4 py-2 rounded-lg hover:bg-zinc-100 transition-colors">
              Start a task
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => {
              const cfg = statusConfig[task.status] ?? statusConfig.pending;
              return (
                <div
                  key={task.id}
                  className="group bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-xl p-4 transition-all cursor-pointer"
                  onClick={() => router.push(`/?task_id=${task.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{task.goal}</p>
                        {task.status === "completed" && task.result?.summary && (
                          <p className="text-xs text-zinc-500 mt-0.5 truncate">{task.result.summary}</p>
                        )}
                        {task.status === "failed" && task.failure_reason && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{task.failure_reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                      {(task.status === "running" || task.status === "pending") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelTask(task.id); }}
                          className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 px-2 py-0.5 rounded-full transition-colors"
                        >
                          Stop
                        </button>
                      )}
                      <span className="text-xs text-zinc-600">{timeAgo(task.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
