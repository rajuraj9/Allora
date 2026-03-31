"use client";

import { TaskResult } from "@/lib/types";

interface ResultDisplayProps {
  result: TaskResult;
  taskId: string;
}

// Strip markdown fences and parse JSON from LLM output
function parseCleanData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try { return JSON.parse(stripped); } catch { return stripped; }
}

function cleanExtractedData(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_")) continue; // skip internal keys like _streaming_url
    cleaned[k] = parseCleanData(v);
  }
  // If there's a "result" key that's a string with JSON, unwrap it
  if (cleaned.result && typeof cleaned.result === "string") {
    const parsed = parseCleanData(cleaned.result);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  }
  return cleaned;
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(data: unknown, filename: string) {
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(data)) rows = data;
  else if (typeof data === "object" && data !== null) {
    const first = Object.values(data as Record<string, unknown>).find(Array.isArray);
    if (first) rows = first as Record<string, unknown>[];
    else rows = [data as Record<string, unknown>];
  }
  if (!rows.length) return downloadJSON(data, filename.replace(".csv", ".json"));
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Render a single value nicely
function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-zinc-400 italic">—</span>;
  if (typeof value === "boolean") return <span className={value ? "text-green-600" : "text-red-500"}>{value ? "Yes" : "No"}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400 italic">empty</span>;
    if (typeof value[0] === "string") {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => <span key={i} className="bg-zinc-100 text-zinc-700 text-xs px-2 py-0.5 rounded-full">{String(v)}</span>)}
        </div>
      );
    }
  }
  if (typeof value === "string" && value.startsWith("http")) {
    return <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs truncate max-w-xs block">{value}</a>;
  }
  return <span className="text-zinc-800 text-sm">{String(value)}</span>;
}

// Render an array of objects as a table
function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 border-b border-zinc-200">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                {h.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-b border-zinc-100 ${i % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}`}>
              {headers.map((h) => (
                <td key={h} className="px-4 py-2.5 align-top max-w-xs">
                  <ValueCell value={row[h]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Render key-value pairs as cards
function KeyValueCards({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="bg-white border border-zinc-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">{key.replace(/_/g, " ")}</p>
          <ValueCell value={value} />
        </div>
      ))}
    </div>
  );
}

export default function ResultDisplay({ result, taskId }: ResultDisplayProps) {
  const cleaned = cleanExtractedData(result.extracted_data);
  const keys = Object.keys(cleaned);

  // Find the primary data — prefer arrays
  const arrayEntry = Object.entries(cleaned).find(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0);
  const primaryArray = arrayEntry ? arrayEntry[1] as Record<string, unknown>[] : null;
  const primaryKey = arrayEntry?.[0];

  // Scalar fields (non-array, non-object)
  const scalarData = Object.fromEntries(
    Object.entries(cleaned).filter(([k, v]) => k !== primaryKey && !Array.isArray(v) && typeof v !== "object")
  );

  const filename = `allora-${taskId.slice(0, 8)}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-base">✅</div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Task Completed</h3>
            <p className="text-xs text-zinc-500">{result.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCSV(primaryArray ?? cleaned, `${filename}.csv`)}
            className="text-xs font-medium text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            ↓ CSV
          </button>
          <button
            onClick={() => downloadJSON(cleaned, `${filename}.json`)}
            className="text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            ↓ JSON
          </button>
        </div>
      </div>

      {/* Scalar key-value cards */}
      {Object.keys(scalarData).length > 0 && (
        <KeyValueCards data={scalarData} />
      )}

      {/* Array data as table */}
      {primaryArray && primaryArray.length > 0 && typeof primaryArray[0] === "object" && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            {primaryKey?.replace(/_/g, " ")} · {primaryArray.length} results
          </p>
          <DataTable rows={primaryArray} />
        </div>
      )}

      {/* Fallback: no structured data */}
      {keys.length === 0 && (
        <p className="text-sm text-zinc-400 italic">No structured data extracted.</p>
      )}
    </div>
  );
}
