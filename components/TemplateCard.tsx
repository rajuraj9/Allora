"use client";

import { Template } from "@/lib/templates";

interface TemplateCardProps {
  template: Template;
  onSelect: (template: Template) => void;
  isRecent?: boolean;
  isCustom?: boolean;
}

const categoryColors: Record<string, string> = {
  Research:   "bg-blue-400/10 text-blue-400",
  Actions:    "bg-purple-400/10 text-purple-400",
  Monitoring: "bg-amber-400/10 text-amber-400",
  Utility:    "bg-green-400/10 text-green-400",
};

export default function TemplateCard({ template, onSelect, isRecent, isCustom }: TemplateCardProps) {
  return (
    <button
      onClick={() => onSelect(template)}
      className="group w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20 p-4 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-white/20"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl">{template.icon}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {isCustom && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              My Template
            </span>
          )}
          {isRecent && (
            <span className="text-xs bg-white/10 text-zinc-400 px-1.5 py-0.5 rounded-full">Recent</span>
          )}
          {!isCustom && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${categoryColors[template.category]}`}>
              {template.category}
            </span>
          )}
        </div>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-white">{template.title}</h3>
      <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{template.description}</p>
      <div className="mt-3 flex items-center gap-3 text-xs text-zinc-600">
        <span>⏱ {template.estimatedTime}</span>
        <span>·</span>
        <span>{template.fields.length} input{template.fields.length !== 1 ? "s" : ""}</span>
      </div>
    </button>
  );
}
