"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { StepLog, TaskStatus, TaskResult, UserInputRequest } from "@/lib/types";
import StepLogItem from "./StepLogItem";
import UserInputForm from "./UserInputForm";
import SafetyConfirmationDialog from "./SafetyConfirmationDialog";
import FailureDisplay from "./FailureDisplay";

interface ExecutionViewProps {
  task_id: string;
  token: string;
  onUserResponse: (fields: Record<string, string>) => void;
  onConfirm: (confirmed: boolean) => void;
}

interface TaskStatusResponse {
  task_id: string;
  status: TaskStatus;
  steps: StepLog[];
  result?: TaskResult;
  pending_input?: UserInputRequest;
  failure_reason?: string;
}

const statusBadge: Record<TaskStatus, string> = {
  pending: "bg-zinc-100 text-zinc-600",
  running: "bg-blue-100 text-blue-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export default function ExecutionView({
  task_id,
  token,
  onUserResponse,
  onConfirm,
}: ExecutionViewProps) {
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [result, setResult] = useState<TaskResult | undefined>();
  const [pendingInput, setPendingInput] = useState<UserInputRequest | undefined>();
  const [failureReason, setFailureReason] = useState<string | undefined>();
  const [cancelling, setCancelling] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabaseRef = useRef(getBrowserSupabase());

  async function getFreshToken(): Promise<string> {
    const { data } = await supabaseRef.current.auth.getSession();
    return data.session?.access_token ?? token;
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const freshToken = await getFreshToken();
      await fetch(`/api/task/${task_id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      setStatus("failed");
      setFailureReason("Cancelled by user");
    } finally {
      setCancelling(false);
    }
  }

  async function fetchStatus() {
    try {
      const freshToken = await getFreshToken();
      const res = await fetch(`/api/task/${task_id}/status`, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (!res.ok) return;
      const data: TaskStatusResponse = await res.json();
      setStatus(data.status);
      setSteps(data.steps ?? []);
      setResult(data.result);
      setPendingInput(data.pending_input);
      setFailureReason(data.failure_reason);
    } catch {
      // silently ignore poll errors
    }
  }

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Supabase Realtime subscription for step_logs
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`step_logs:${task_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "step_logs",
          filter: `task_id=eq.${task_id}`,
        },
        (payload) => {
          const newStep = payload.new as StepLog;
          if (!newStep?.id) return;
          setSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === newStep.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = newStep;
              return updated;
            }
            return [...prev, newStep];
          });
          // Also refresh full status to pick up task-level changes
          fetchStatus();
        }
      )
      .subscribe();

    // Polling fallback every 1.5 seconds
    pollRef.current = setInterval(fetchStatus, 1500);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task_id]);

  // Stop polling once terminal state reached
  useEffect(() => {
    if (status === "completed" || status === "failed") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [status]);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Task Execution</h2>
        <div className="flex items-center gap-2">
          {(status === "running" || status === "pending") && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs font-medium text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50"
            >
              {cancelling ? "Stopping…" : "⏹ Stop"}
            </button>
          )}
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge[status]}`}>
            {status}
          </span>
        </div>
      </div>

      {/* Step log list */}
      {steps.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-500">Steps</h3>
          {steps.map((step) => (
            <StepLogItem key={step.id} step={step} />
          ))}
        </div>
      )}

      {steps.length === 0 && status === "pending" && (
        <p className="text-sm text-zinc-400">Waiting for agent to start…</p>
      )}

      {steps.length === 0 && status === "running" && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Planning steps…
        </div>
      )}

      {/* User input forms */}
      {pendingInput &&
        (pendingInput.type === "missing_fields" ||
          pendingInput.type === "credentials") && (
          <UserInputForm request={pendingInput} onSubmit={onUserResponse} />
        )}

      {pendingInput && pendingInput.type === "safety_confirmation" && (
        <SafetyConfirmationDialog request={pendingInput} onConfirm={onConfirm} />
      )}

      {/* Failure display */}
      {status === "failed" && failureReason && (
        <FailureDisplay
          failure_reason={failureReason}
          onRetry={() => window.location.reload()}
        />
      )}

      {/* Completed result */}
      {status === "completed" && result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-lg">✅</span>
            <h3 className="text-sm font-semibold text-green-800">Task Completed</h3>
          </div>
          <p className="text-sm text-green-700">{result.summary}</p>
          {Object.keys(result.extracted_data).length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-green-700 mb-1">Extracted Data</p>
              <pre className="text-xs bg-green-100 rounded p-2 overflow-auto text-green-900">
                {JSON.stringify(result.extracted_data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
