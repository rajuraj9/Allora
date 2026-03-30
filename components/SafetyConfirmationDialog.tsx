"use client";

import { UserInputRequest } from "@/lib/types";

interface SafetyConfirmationDialogProps {
  request: UserInputRequest;
  onConfirm: (confirmed: boolean) => void;
}

export default function SafetyConfirmationDialog({
  request,
  onConfirm,
}: SafetyConfirmationDialogProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-amber-500 text-xl">⚠️</span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-800 mb-1">
            Safety Confirmation Required
          </h3>
          <p className="text-sm text-amber-700">{request.message}</p>
          {request.action_summary && (
            <div className="mt-2 rounded bg-amber-100 border border-amber-200 px-3 py-2">
              <p className="text-sm text-amber-900 font-medium">Action to perform:</p>
              <p className="text-sm text-amber-800 mt-0.5">{request.action_summary}</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(true)}
          className="text-sm font-medium bg-amber-600 text-white rounded-md px-4 py-1.5 hover:bg-amber-700 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onConfirm(false)}
          className="text-sm font-medium border border-zinc-300 text-zinc-700 rounded-md px-4 py-1.5 hover:bg-zinc-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
