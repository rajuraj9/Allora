"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface LoginFormProps {
  onLogin: () => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabase();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else { setMessage("Check your email to confirm, then sign in."); setMode("login"); }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else onLogin();
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-lg">✦</div>
          <span className="text-white text-xl font-bold tracking-tight">Allora AI</span>
        </div>
        <p className="text-zinc-400 text-sm">The internet, on your terms.</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
        <h2 className="text-white text-lg font-semibold mb-1">
          {mode === "login" ? "Welcome back" : "Create account"}
        </h2>
        <p className="text-zinc-400 text-xs mb-6">
          {mode === "login" ? "Sign in to your workspace" : "Start automating the web"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {message && <p className="text-green-400 text-xs">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-zinc-900 text-sm font-semibold py-2.5 rounded-lg hover:bg-zinc-100 disabled:opacity-50 transition-colors"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-zinc-500">
          {mode === "login" ? "No account?" : "Already have one?"}{" "}
          <button
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); setMessage(null); }}
            className="text-white hover:underline font-medium"
          >
            {mode === "login" ? "Sign up free" : "Sign in"}
          </button>
        </p>
      </div>

      {/* Footer tagline */}
      <p className="mt-8 text-zinc-600 text-xs text-center">
        Powered by real browser automation · No bots, no scrapers
      </p>
    </div>
  );
}
