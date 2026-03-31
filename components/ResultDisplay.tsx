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

function downloadHTML(data: Record<string, unknown>, summary: string, filename: string) {
  const now = new Date().toLocaleString();

  function renderValue(v: unknown): string {
    if (v === null || v === undefined) return `<span style="color:#9ca3af">—</span>`;
    if (typeof v === "boolean") return v
      ? `<span style="color:#16a34a;font-weight:600">✓ Yes</span>`
      : `<span style="color:#dc2626;font-weight:600">✗ No</span>`;
    if (typeof v === "string" && v.startsWith("http"))
      return `<a href="${v}" target="_blank" style="color:#2563eb;text-decoration:underline;word-break:break-all">${v}</a>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<span style="color:#9ca3af">—</span>`;
      if (typeof v[0] === "string")
        return v.map((s) => `<span style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:2px 10px;font-size:12px;color:#374151">${s}</span>`).join(" ");
      return `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;overflow:auto">${JSON.stringify(v, null, 2)}</pre>`;
    }
    if (typeof v === "object")
      return `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:12px;overflow:auto">${JSON.stringify(v, null, 2)}</pre>`;
    return `<span style="color:#111827">${String(v)}</span>`;
  }

  function renderTable(rows: Record<string, unknown>[]): string {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const ths = headers.map((h) => `<th style="text-align:left;padding:10px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;background:#f9fafb;border-bottom:2px solid #e5e7eb;white-space:nowrap">${h.replace(/_/g, " ")}</th>`).join("");
    const trs = rows.map((row, i) =>
      `<tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"};border-bottom:1px solid #f3f4f6">
        ${headers.map((h) => `<td style="padding:10px 16px;vertical-align:top;font-size:13px">${renderValue(row[h])}</td>`).join("")}
      </tr>`
    ).join("");
    return `<div style="overflow-x:auto;border-radius:12px;border:1px solid #e5e7eb;margin-top:8px">
      <table style="width:100%;border-collapse:collapse"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
    </div>`;
  }

  function renderSection(key: string, value: unknown): string {
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return `<section style="margin-bottom:32px">
        <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 4px">${label}</h2>
        <p style="font-size:12px;color:#6b7280;margin:0 0 8px">${value.length} result${value.length !== 1 ? "s" : ""}</p>
        ${renderTable(value as Record<string, unknown>[])}
      </section>`;
    }
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin:0 0 6px">${label}</p>
      <div style="font-size:14px;color:#111827">${renderValue(value)}</div>
    </div>`;
  }

  const scalarEntries = Object.entries(data).filter(([, v]) => !Array.isArray(v) && typeof v !== "object");
  const arrayEntries = Object.entries(data).filter(([, v]) => Array.isArray(v));
  const objectEntries = Object.entries(data).filter(([, v]) => !Array.isArray(v) && typeof v === "object" && v !== null);

  const scalarGrid = scalarEntries.length > 0
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:32px">
        ${scalarEntries.map(([k, v]) => renderSection(k, v)).join("")}
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allora AI — Results</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827;margin:0;padding:0}
  a{color:#2563eb}
</style>
</head>
<body>
<div style="max-width:960px;margin:0 auto;padding:40px 24px">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #e5e7eb">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;background:#111827;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px">✦</div>
      <div>
        <h1 style="font-size:20px;font-weight:800;color:#111827;margin:0">Allora AI</h1>
        <p style="font-size:12px;color:#6b7280;margin:0">Autonomous Web Agent</p>
      </div>
    </div>
    <div style="text-align:right">
      <p style="font-size:12px;color:#6b7280;margin:0">Generated</p>
      <p style="font-size:13px;font-weight:600;color:#374151;margin:0">${now}</p>
    </div>
  </div>

  <!-- Summary -->
  <div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:32px;display:flex;align-items:center;gap:12px">
    <span style="font-size:20px">✅</span>
    <p style="font-size:14px;color:#166534;font-weight:500;margin:0">${summary}</p>
  </div>

  <!-- Scalar cards grid -->
  ${scalarGrid}

  <!-- Array tables -->
  ${arrayEntries.map(([k, v]) => renderSection(k, v)).join("")}

  <!-- Object sections -->
  ${objectEntries.map(([k, v]) => renderSection(k, v)).join("")}

  <!-- Footer -->
  <div style="margin-top:48px;padding-top:24px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="font-size:12px;color:#9ca3af">Generated by <strong>Allora AI</strong> · alloraai.vercel.app</p>
  </div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
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
            onClick={() => downloadHTML(cleaned, result.summary, `${filename}.html`)}
            className="text-xs font-medium text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            ↓ HTML
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
