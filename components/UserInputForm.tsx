"use client";

import { useState } from "react";
import { UserInputRequest, FormField } from "@/lib/types";

interface UserInputFormProps {
  request: UserInputRequest;
  onSubmit: (fields: Record<string, string>) => void;
}

export default function UserInputForm({ request, onSubmit }: UserInputFormProps) {
  const fields = request.fields ?? [];
  const initial = Object.fromEntries(fields.map((f) => [f.name, ""]));
  const [values, setValues] = useState<Record<string, string>>(initial);

  function handleChange(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="text-sm font-semibold text-blue-800 mb-3">{request.message}</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {fields.map((field: FormField) => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {field.type === "select" ? (
              <select
                name={field.name}
                required={field.required}
                value={values[field.name] ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.name}
                required={field.required}
                value={values[field.name] ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          className="text-sm font-medium bg-blue-600 text-white rounded-md px-4 py-1.5 hover:bg-blue-700 transition-colors"
        >
          Submit
        </button>
      </form>
    </div>
  );
}
