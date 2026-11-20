"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Globe, Loader2, Sparkles, X } from "lucide-react";
import {
  createSearchProfile, getWebsiteAnalysis, startWebsiteAnalysis, updateSearchProfile,
  type LeadPlatform, type SearchProfile, type SearchProfileInput,
} from "@/lib/api/leadFinderApi";
import TagInput from "./TagInput";
import { PLATFORM_LABEL } from "./format";

interface Props {
  /** Edit this profile; omit to create a new one (starts with website analysis). */
  profile?: SearchProfile;
  onClose: () => void;
  onSaved: (profile: SearchProfile) => void;
}

const EMPTY: SearchProfileInput = {
  name: "",
  websiteUrl: "",
  summary: "",
  keywords: [],
  subreddits: [],
  exclusions: [],
  platforms: ["REDDIT", "FACEBOOK"],
};

export default function ProfileEditor({ profile, onClose, onSaved }: Props) {
  const [step, setStep] = useState<"website" | "form">(profile ? "form" : "website");
  const [form, setForm] = useState<SearchProfileInput>(
    profile
      ? {
          name: profile.name,
          websiteUrl: profile.websiteUrl ?? "",
          summary: profile.summary ?? "",
          keywords: profile.keywords,
          subreddits: profile.subreddits,
          exclusions: profile.exclusions,
          platforms: profile.platforms,
        }
      : EMPTY,
  );
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled.current = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = <K extends keyof SearchProfileInput>(key: K, value: SearchProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function analyze(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAnalyzing(true);
    try {
      const started = await startWebsiteAnalysis(url);
      let job = started;
      // Poll until the analysis job finishes (the dashboard "checks progress").
      for (let i = 0; i < 40 && (job.status === "PENDING" || job.status === "RUNNING"); i++) {
        await new Promise((r) => setTimeout(r, 1200));
        if (cancelled.current) return;
        job = await getWebsiteAnalysis(started.jobId);
      }
      if (job.status !== "COMPLETED" || !job.result) throw new Error(job.error || "Website analysis did not finish");
      setForm({
        name: job.result.suggestedName,
        websiteUrl: job.url,
        summary: job.result.summary,
        keywords: job.result.keywords,
        subreddits: job.result.subreddits,
        exclusions: job.result.exclusions,
        platforms: ["REDDIT", "FACEBOOK"],
      });
      setStep("form");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Website analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.keywords.length) return setError("Add at least one keyword.");
    if (!form.platforms.length) return setError("Pick at least one platform.");
    setSaving(true);
    try {
      const payload: SearchProfileInput = {
        ...form,
        websiteUrl: form.websiteUrl?.trim() || undefined,
        summary: form.summary?.trim() || undefined,
      };
      const saved = profile ? await updateSearchProfile(profile.id, payload) : await createSearchProfile(payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the profile");
    } finally {
      setSaving(false);
    }
  }

  const togglePlatform = (p: LeadPlatform) =>
    set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="profile-editor-title" className="font-heading text-lg font-bold text-gray-900">
            {profile ? "Edit search profile" : step === "website" ? "Add your website" : "Confirm your search profile"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === "website" ? (
          <form onSubmit={analyze} className="space-y-4 px-5 py-5">
            <p className="text-sm text-gray-600">
              Paste your business website. We work out what you offer and suggest keywords, subreddits and words to exclude.
            </p>
            <label htmlFor="website-url" className="block text-sm font-semibold text-gray-800">
              Website address
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="website-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="yourbusiness.com"
                  disabled={analyzing}
                  className="w-full rounded-xl border border-[#E5E7EB] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
              <button
                type="submit"
                disabled={analyzing}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {analyzing ? "Analyzing your website…" : "Analyze"}
              </button>
            </div>
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              Demo: the website analysis is simulated. Suggestions are picked from the domain name.
            </p>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button type="button" onClick={() => setStep("form")} className="text-sm font-semibold text-gray-500 hover:text-gray-800">
              Skip and fill in by hand
            </button>
          </form>
        ) : (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {form.summary && !profile && (
                <p className="rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900 ring-1 ring-orange-200">{form.summary}</p>
              )}
              <div>
                <label htmlFor="profile-name" className="block text-sm font-semibold text-gray-800">
                  Profile name
                </label>
                <input
                  id="profile-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  required
                  maxLength={80}
                  placeholder="e.g. Web development leads"
                  className="mt-1.5 w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
              <TagInput
                id="profile-keywords"
                label="Keywords"
                hint="Phrases people use when they want to hire you. Press Enter after each."
                values={form.keywords}
                onChange={(v) => set("keywords", v)}
                placeholder="hiring web developer"
                max={10}
              />
              <fieldset>
                <legend className="text-sm font-semibold text-gray-800">Search on</legend>
                <div className="mt-1.5 flex gap-2">
                  {(["REDDIT", "FACEBOOK"] as LeadPlatform[]).map((p) => (
                    <label
                      key={p}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                        form.platforms.includes(p) ? "border-orange-400 bg-orange-50 text-orange-900" : "border-[#E5E7EB] text-gray-700"
                      }`}
                    >
                      <input type="checkbox" checked={form.platforms.includes(p)} onChange={() => togglePlatform(p)} className="accent-orange-500" />
                      {PLATFORM_LABEL[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
              {form.platforms.includes("REDDIT") && (
                <TagInput
                  id="profile-subreddits"
                  label="Subreddits"
                  hint="Leave empty to search all of Reddit."
                  values={form.subreddits}
                  onChange={(v) => set("subreddits", v)}
                  placeholder="forhire"
                  prefix="r/"
                  max={15}
                />
              )}
              <TagInput
                id="profile-exclusions"
                label="Exclude posts containing"
                hint="Posts with any of these words never show up as leads."
                values={form.exclusions}
                onChange={(v) => set("exclusions", v)}
                placeholder="[for hire]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
              {error && <p className="mr-auto text-sm text-rose-600">{error}</p>}
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save profile
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
