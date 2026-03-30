"use client";

import { useEffect, useState } from "react";
import { StepLog } from "@/lib/types";

interface StepLogItemProps {
  step: StepLog;
}

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(since).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="text-xs text-blue-500 tabular-nums">{elapsed}s</span>;
}

const statusIcon: Record<StepLog["status"], string> = {
  pending: "⏳",
  running: "🌐",
  success: "✅",
  failed: "❌",
  skipped: "⏭️",
};

const statusColor: Record<StepLog["status"], string> = {
  pending: "text-zinc-400",
  running: "text-blue-600",
  success: "text-green-600",
  failed: "text-red-600",
  skipped: "text-gray-400",
};

const statusBg: Record<StepLog["status"], string> = {
  pending: "bg-zinc-100 text-zinc-600",
  running: "bg-blue-100 text-blue-700",
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
};

export default function StepLogItem({ step }: StepLogItemProps) {
  const truncated =
    step.target.length > 60 ? step.target.slice(0, 57) + "..." : step.target;

  const streamingUrl =
    (step.result?.extracted_data as Record<string, unknown> | undefined)
      ?._streaming_url as string | undefined;

  const progressLog =
    (step.result?.extracted_data as Record<string, unknown> | undefined)
      ?._progress_log as string[] | undefined;

  // Demo mode live progress text
  const demoProgress =
    (step.result?.extracted_data as Record<string, unknown> | undefined)
      ?._progress as string | undefined;

  const isRunning = step.status === "running";

  return (
    <div className={`rounded-lg border bg-white overflow-hidden ${
      isRunning ? "border-blue-200 shadow-sm" : "border-zinc-100"
    }`}>
      {/* Header row */}
      <div className="flex items-start gap-3 py-2 px-3">
        <span className={`mt-0.5 text-base ${statusColor[step.status]} ${isRunning ? "animate-spin" : ""}`}>
          {statusIcon[step.status]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded">
              {step.action_type}
            </span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${statusBg[step.status]}`}>
              {step.status}
            </span>
            {isRunning && <ElapsedTimer since={step.timestamp} />}
            {step.retry_count > 0 && (
              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                retry ×{step.retry_count}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-600 truncate" title={step.target}>
            {truncated}
          </p>
        </div>
      </div>

      {/* Live browser iframe — only while running */}
      {streamingUrl && isRunning && (
        <div className="border-t border-blue-100">
          <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50">
            <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Live browser
            </span>
            <a
              href={streamingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              Open full screen ↗
            </a>
          </div>
          <iframe
            src={streamingUrl}
            className="w-full border-0"
            style={{ height: "480px" }}
            title="Live browser view"
            allow="autoplay"
          />
        </div>
      )}

      {/* Progress log — shown while running (live feed) and after completion */}
      {progressLog && progressLog.length > 0 && (
        <div className="border-t border-zinc-100 px-3 py-2 space-y-0.5">
          {progressLog.map((p, i) => (
            <p key={i} className="text-xs text-zinc-500 flex items-start gap-1">
              <span className="text-zinc-300 mt-0.5">›</span>{p}
            </p>
          ))}
        </div>
      )}

      {/* Connecting state — before streaming URL arrives */}
      {isRunning && !streamingUrl && (
        <div className="px-3 pb-2">
          <p className="text-xs text-blue-400 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {demoProgress ?? "Connecting to browser…"}
          </p>
        </div>
      )}
    </div>
  );
}
