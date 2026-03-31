"use client";

import { useState } from "react";
import { TaskResult } from "@/lib/types";

interface ResultDisplayProps {
  result: TaskResult;
  taskId: string;
}

// ── Data cleaning ─────────────────────────────────────────────────

function parseCleanData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch { return stripped; }
}

function cleanExtractedData(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_")) continue;
    cleaned[k] = parseCleanData(v);
  }
  if (cleaned.result && typeof cleaned.result === "string") {
    const parsed = parseCleanData(cleaned.result);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  }
  return cleaned;
}

// ── Downloads ─────────────────────────────────────────────────────

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
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
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadHTML(data: Record<string, unknown>, summary: string, filename: string) {
  const now = new Date().toLocaleString();

  function rv(v: unknown): string {
    if (v === null || v === undefined) return `<span style="color:#6b7280">—</span>`;
    if (typeof v === "boolean") return v ? `<span style="color:#4ade80">✓ Yes</span>` : `<span style="color:#f87171">✗ No</span>`;
    if (typeof v === "string" && v.startsWith("http")) return `<a href="${v}" target="_blank" style="color:#60a5fa;text-decoration:underline;word-break:break-all">${v}</a>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<span style="color:#6b7280">—</span>`;
      if (typeof v[0] === "string") return v.map((s) => `<span style="background:#1f2937;border:1px solid #374151;border-radius:999px;padding:2px 10px;font-size:11px;color:#d1d5db">${s}</span>`).join(" ");
      return `<pre style="background:#111827;border:1px solid #374151;border-radius:6px;padding:10px;font-size:11px;color:#d1d5db;overflow:auto">${JSON.stringify(v, null, 2)}</pre>`;
    }
    if (typeof v === "object") return `<pre style="background:#111827;border:1px solid #374151;border-radius:6px;padding:10px;font-size:11px;color:#d1d5db;overflow:auto">${JSON.stringify(v, null, 2)}</pre>`;
    return `<span style="color:#f9fafb">${String(v)}</span>`;
  }

  const entries = Object.entries(data);
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0);
  const scalarEntries = entries.filter(([, v]) => !Array.isArray(v) && typeof v !== "object");

  const scalarRows = scalarEntries.map(([k, v]) =>
    `<tr style="border-bottom:1px solid #1f2937">
      <td style="padding:12px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;white-space:nowrap;width:180px">${k.replace(/_/g, " ")}</td>
      <td style="padding:12px 16px;font-size:13px">${rv(v)}</td>
    </tr>`
  ).join("");

  const arrayTables = arrayEntries.map(([k, v]) => {
    const rows = v as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    const ths = headers.map((h) => `<th style="text-align:left;padding:10px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;background:#111827;border-bottom:1px solid #374151;white-space:nowrap">${h.replace(/_/g, " ")}</th>`).join("");
    const trs = rows.map((row, i) => `<tr style="border-bottom:1px solid #1f2937;background:${i % 2 === 0 ? "#0d1117" : "#111827"}">${headers.map((h) => `<td style="padding:10px 16px;font-size:13px;vertical-align:top">${rv(row[h])}</td>`).join("")}</tr>`).join("");
    return `<div style="margin-bottom:32px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <h2 style="font-size:13px;font-weight:700;color:#f9fafb;margin:0">${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</h2>
        <span style="background:#1f2937;border:1px solid #374151;border-radius:999px;padding:1px 8px;font-size:11px;color:#9ca3af">${rows.length}</span>
      </div>
      <div style="border:1px solid #374151;border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
      </div>
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Allora AI Report</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#f9fafb;margin:0;padding:0">
<div style="max-width:1000px;margin:0 auto;padding:40px 24px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #21262d">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;background:#f9fafb;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#0d1117;font-size:14px;font-weight:900">✦</div>
      <span style="font-size:16px;font-weight:800;color:#f9fafb">Allora AI</span>
    </div>
    <span style="font-size:12px;color:#6b7280">${now}</span>
  </div>
  <div style="background:#1a2332;border:1px solid #2d6a4f;border-radius:8px;padding:14px 18px;margin-bottom:28px;display:flex;align-items:center;gap:10px">
    <span style="color:#4ade80;font-size:16px">✓</span>
    <span style="font-size:13px;color:#86efac;font-weight:500">${summary}</span>
  </div>
  ${scalarEntries.length > 0 ? `<div style="border:1px solid #21262d;border-radius:8px;overflow:hidden;margin-bottom:28px"><table style="width:100%;border-collapse:collapse">${scalarRows}</table></div>` : ""}
  ${arrayTables}
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #21262d;text-align:center">
    <p style="font-size:11px;color:#6b7280;margin:0">Generated by <strong style="color:#9ca3af">Allora AI</strong></p>
  </div>
</div></body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Inline renderers ──────────────────────────────────────────────

function InlineValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-zinc-600">—</span>;
  if (typeof value === "boolean") return <span className={value ? "text-green-400" : "text-red-400"}>{value ? "✓ Yes" : "✗ No"}</span>;
  if (typeof value === "string" && value.startsWith("http"))
    return <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate max-w-xs block text-xs">{value}</a>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-zinc-600">—</span>;
    if (typeof value[0] === "string")
      return <div className="flex flex-wrap gap-1">{value.map((v, i) => <span key={i} className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs px-2 py-0.5 rounded-full">{String(v)}</span>)}</div>;
    return <span className="text-zinc-400 text-xs">{value.length} items</span>;
  }
  return <span className="text-zinc-200 text-sm">{String(value)}</span>;
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = String(a[sortKey] ?? ""), bv = String(b[sortKey] ?? "");
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : rows;

  function toggleSort(h: string) {
    if (sortKey === h) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(h); setSortDir("asc"); }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            {headers.map((h) => (
              <th key={h} onClick={() => toggleSort(h)}
                className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-zinc-300 select-none bg-zinc-950">
                {h.replace(/_/g, " ")}
                {sortKey === h && <span className="ml-1 text-zinc-400">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
              {headers.map((h) => (
                <td key={h} className="px-4 py-3 align-top max-w-xs">
                  <InlineValue value={row[h]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function ResultDisplay({ result, taskId }: ResultDisplayProps) {
  const cleaned = cleanExtractedData(result.extracted_data);
  const filename = `allora-${taskId.slice(0, 8)}`;

  const scalarEntries = Object.entries(cleaned).filter(([, v]) => !Array.isArray(v) && typeof v !== "object");
  const arrayEntries = Object.entries(cleaned).filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0);
  const primaryArray = arrayEntries[0]?.[1] as Record<string, unknown>[] | undefined;

  return (
    <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-sm font-semibold text-white">Task Completed</span>
          <span className="text-xs text-zinc-500 hidden sm:block">{result.summary}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadCSV(primaryArray ?? cleaned, `${filename}.csv`)}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-lg transition-colors">
            ↓ CSV
          </button>
          <button onClick={() => downloadHTML(cleaned, result.summary, `${filename}.html`)}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-lg transition-colors">
            ↓ HTML
          </button>
          <button onClick={() => downloadJSON(cleaned, `${filename}.json`)}
            className="text-xs text-white bg-zinc-700 hover:bg-zinc-600 px-3 py-1.5 rounded-lg transition-colors">
            ↓ JSON
          </button>
        </div>
      </div>

      {/* Scalar fields as compact rows */}
      {scalarEntries.length > 0 && (
        <div className="border-b border-zinc-800">
          {scalarEntries.map(([k, v]) => (
            <div key={k} className="flex items-start gap-4 px-5 py-3 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50 transition-colors">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide w-36 flex-shrink-0 pt-0.5">
                {k.replace(/_/g, " ")}
              </span>
              <div className="flex-1 min-w-0">
                <InlineValue value={v} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Array tables */}
      {arrayEntries.map(([k, v]) => {
        const rows = v as Record<string, unknown>[];
        return (
          <div key={k} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                {k.replace(/_/g, " ")}
              </span>
              <span className="bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs px-2 py-0.5 rounded-full">
                {rows.length}
              </span>
            </div>
            {typeof rows[0] === "object" ? (
              <DataTable rows={rows} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {rows.map((r, i) => <span key={i} className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs px-3 py-1 rounded-full">{String(r)}</span>)}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {scalarEntries.length === 0 && arrayEntries.length === 0 && (
        <div className="px-5 py-8 text-center text-zinc-600 text-sm">No structured data extracted.</div>
      )}
    </div>
  );
}
