"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

interface Props {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  prefix?: string;
  max?: number;
}

/** Chips input: Enter or comma adds, Backspace on empty removes the last one. */
export default function TagInput({ id, label, hint, values, onChange, placeholder, prefix, max = 20 }: Props) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      // Subreddits are stored without "r/", whichever way the user types them.
      .map((s) => (prefix === "r/" ? s.replace(/^\/?r\//i, "") : s))
      .filter(Boolean);
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-2 py-1.5 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex max-w-full items-center gap-1 rounded-lg bg-orange-50 py-1 pl-2 pr-1 text-sm text-orange-800 ring-1 ring-orange-200"
          >
            <span className="truncate">
              {prefix}
              {v}
            </span>
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded p-0.5 text-orange-600 hover:bg-orange-100"
              aria-label={`Remove ${v}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-gray-400"
        />
      </div>
    </div>
  );
}
