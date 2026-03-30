"use client";

interface FailureDisplayProps {
  failure_reason: string;
  onRetry: () => void;
}

export default function FailureDisplay({ failure_reason, onRetry }: FailureDisplayProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-red-500 text-xl">❌</span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-red-800 mb-1">Task Failed</h3>
          <p className="text-sm text-red-700">{failure_reason}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="mt-3 text-sm font-medium text-red-700 border border-red-300 rounded-md px-3 py-1.5 hover:bg-red-100 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
