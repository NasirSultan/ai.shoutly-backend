"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2, Inbox, Loader2, Pencil, Plus, Radar, RefreshCcw, Trash2, TriangleAlert,
} from "lucide-react";
import {
  deleteSearchProfile, getFetchStatus, listLeads, listSearchProfiles, requestLeads, updateLead,
  type Lead, type LeadFilters, type LeadList, type LeadPlatform, type LeadSentiment, type LeadStatus,
  type SearchProfile,
} from "@/lib/api/leadFinderApi";
import { ApiError } from "@/lib/api/apiError";
import LeadCard from "./LeadCard";
import ProfileEditor from "./ProfileEditor";
import { PLATFORM_LABEL, PLATFORM_PILL, timeAgo } from "./format";

type PlatformState =
  | { state: "running"; jobId: string; lastFetchedAt: string | null }
  | { state: "done"; lastFetchedAt: string | null; added?: number }
  | { state: "failed"; lastFetchedAt: string | null; error: string };

const STATUS_TABS: { value: LeadStatus; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "REPLIED", label: "Replied" },
  { value: "DISMISSED", label: "Dismissed" },
];
const POLL_MS = 3000;

export default function LeadFinder() {
  const [profiles, setProfiles] = useState<SearchProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ profile?: SearchProfile } | null>(null);

  const [status, setStatus] = useState<LeadStatus>("NEW");
  const [platform, setPlatform] = useState<LeadPlatform | "">("");
  const [sentiment, setSentiment] = useState<LeadSentiment | "">("");
  const [sort, setSort] = useState<"newest" | "score">("score");
  const [data, setData] = useState<LeadList | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [busyLead, setBusyLead] = useState<string | null>(null);

  const [fetchState, setFetchState] = useState<Partial<Record<LeadPlatform, PlatformState>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const selected = profiles?.find((p) => p.id === selectedId) ?? null;
  const fetching = Object.values(fetchState).some((s) => s?.state === "running");

  /* ── data loading ─────────────────────────────────────────── */
  const loadProfiles = useCallback(async (selectId?: string) => {
    const list = await listSearchProfiles();
    setProfiles(list);
    setSelectedId((cur) => selectId ?? (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
  }, []);

  const loadLeads = useCallback(async () => {
    if (!selectedId) return setData(null);
    setLoadingLeads(true);
    try {
      const filters: LeadFilters = { profileId: selectedId, status, sort };
      if (platform) filters.platform = platform;
      if (sentiment) filters.sentiment = sentiment;
      setData(await listLeads(filters));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load leads");
    } finally {
      setLoadingLeads(false);
    }
  }, [selectedId, status, platform, sentiment, sort]);

  useEffect(() => {
    loadProfiles().catch(() => {
      setProfiles([]);
      setNotice("Can't reach the lead finder API. Is the backend running on port 4100?");
    });
  }, [loadProfiles]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // A different profile has its own fetch state.
  useEffect(() => {
    setFetchState({});
    setNotice(null);
  }, [selectedId]);

  /* ── Get leads: cache hit is instant, a miss returns jobs to poll ── */
  async function getLeads() {
    if (!selected) return;
    setNotice(null);
    try {
      const res = await requestLeads(selected.id);
      const next: Partial<Record<LeadPlatform, PlatformState>> = {};
      for (const p of res.platforms) {
        next[p.platform] =
          p.status === "pending" && p.jobId
            ? { state: "running", jobId: p.jobId, lastFetchedAt: p.lastFetchedAt }
            : { state: "done", lastFetchedAt: p.lastFetchedAt };
      }
      setFetchState(next);
      if (res.status === "ready") loadLeads();
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.status === 429
          ? "Please wait a moment before refreshing again."
          : err instanceof Error ? err.message : "Could not get leads",
      );
    }
  }

  // Poll running fetches; when one finishes, refresh the list.
  useEffect(() => {
    if (!fetching || !selectedId) return;
    const profileId = selectedId;
    const timer = setInterval(async () => {
      const running = Object.entries(fetchState).filter(([, s]) => s?.state === "running") as [LeadPlatform, Extract<PlatformState, { state: "running" }>][];
      let changed = false;
      const updates: Partial<Record<LeadPlatform, PlatformState>> = {};
      for (const [p, s] of running) {
        try {
          const job = await getFetchStatus(s.jobId, profileId);
          if (job.state === "completed") {
            updates[p] = { state: "done", lastFetchedAt: job.lastFetchedAt ?? null, added: job.leadsAdded };
            changed = true;
          } else if (job.state === "failed") {
            updates[p] = { state: "failed", lastFetchedAt: s.lastFetchedAt, error: job.error ?? "Fetch failed" };
            changed = true;
          }
        } catch {
          /* keep polling */
        }
      }
      if (selectedRef.current !== profileId) return;
      if (Object.keys(updates).length) setFetchState((cur) => ({ ...cur, ...updates }));
      if (changed) loadLeads();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetching, fetchState, selectedId, loadLeads]);

  /* ── lead actions ─────────────────────────────────────────── */
  async function onUpdate(lead: Lead, patch: { status?: LeadStatus; notALead?: boolean }) {
    setBusyLead(lead.id);
    try {
      await updateLead(lead.id, patch);
      await loadLeads();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not update the lead");
    } finally {
      setBusyLead(null);
    }
  }

  async function onDeleteProfile(p: SearchProfile) {
    if (!window.confirm(`Delete the profile "${p.name}"? Its leads stay in your list.`)) return;
    await deleteSearchProfile(p.id);
    await loadProfiles();
  }

  /* ── render ───────────────────────────────────────────────── */
  const failed = Object.entries(fetchState).filter(([, s]) => s?.state === "failed") as [LeadPlatform, Extract<PlatformState, { state: "failed" }>][];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900 sm:text-[28px]">Lead Finder</h1>
          <p className="mt-1 text-sm text-gray-500">
            Public Reddit and Facebook posts from people looking to hire, scored by intent, match and tone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({})}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
        >
          <Plus className="h-4 w-4" /> New search profile
        </button>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── Profiles ── */}
        <aside className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Search profiles</h2>
          {profiles === null ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : profiles.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
              No profiles yet. Add your website and we&apos;ll suggest what to search for.
              <button type="button" onClick={() => setEditor({})} className="mt-3 block font-semibold text-orange-600 hover:text-orange-700">
                Add your website →
              </button>
            </div>
          ) : (
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {profiles.map((p) => {
                const active = p.id === selectedId;
                return (
                  <li key={p.id} className="min-w-[220px] lg:min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        active ? "border-orange-400 bg-white ring-2 ring-orange-100" : "border-[#E5E7EB] bg-white/70 hover:bg-white"
                      }`}
                    >
                      <span className="block truncate font-semibold text-gray-900">{p.name}</span>
                      <span className="mt-1 block truncate text-xs text-gray-500">{p.keywords.join(" · ")}</span>
                      <span className="mt-2 flex gap-1.5">
                        {p.platforms.map((pl) => (
                          <span key={pl} className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${PLATFORM_PILL[pl]}`}>
                            {PLATFORM_LABEL[pl]}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Leads ── */}
        <section className="min-w-0">
          {selected ? (
            <>
              <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-heading truncate text-lg font-bold text-gray-900">{selected.name}</h2>
                    {selected.websiteUrl && <p className="truncate text-xs text-gray-500">{selected.websiteUrl}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setEditor({ profile: selected })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Edit profile">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onDeleteProfile(selected)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Delete profile">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={getLeads}
                      disabled={fetching}
                      className="ml-1 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
                    >
                      {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                      {fetching ? "Finding leads…" : "Get leads"}
                    </button>
                  </div>
                </div>

                {/* per-platform fetch status */}
                {selected.platforms.length > 0 && Object.keys(fetchState).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.platforms.map((pl) => {
                      const s = fetchState[pl];
                      if (!s) return null;
                      return (
                        <span key={pl} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 ring-1 ring-gray-200">
                          {s.state === "running" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
                          ) : s.state === "failed" ? (
                            <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                          <span className="font-semibold">{PLATFORM_LABEL[pl]}</span>
                          {s.state === "running"
                            ? "searching and scoring new posts…"
                            : s.state === "failed"
                              ? "couldn't refresh"
                              : `up to date · checked ${timeAgo(s.lastFetchedAt)}${s.added ? ` · ${s.added} new` : ""}`}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {failed.length > 0 && (
                <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <p className="font-semibold">These results may be outdated.</p>
                  {failed.map(([pl, s]) => (
                    <p key={pl} className="mt-0.5 text-xs text-amber-800">
                      {PLATFORM_LABEL[pl]}: {s.error}
                      {s.lastFetchedAt ? ` · last successful check ${timeAgo(s.lastFetchedAt)}` : ""}
                    </p>
                  ))}
                </div>
              )}
              {notice && (
                <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">{notice}</div>
              )}

              {/* filters */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-white p-1 ring-1 ring-[#E5E7EB]" role="tablist" aria-label="Lead status">
                  {STATUS_TABS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="tab"
                      aria-selected={status === t.value}
                      onClick={() => setStatus(t.value)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                        status === t.value ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {t.label}
                      <span className={`ml-1.5 tabular-nums ${status === t.value ? "text-white/70" : "text-gray-400"}`}>
                        {data?.statusCounts[t.value] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as LeadPlatform | "")}
                  className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                >
                  <option value="">All platforms</option>
                  <option value="REDDIT">Reddit</option>
                  <option value="FACEBOOK">Facebook</option>
                </select>
                <select
                  aria-label="Sentiment"
                  value={sentiment}
                  onChange={(e) => setSentiment(e.target.value as LeadSentiment | "")}
                  className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Any tone</option>
                  <option value="POSITIVE">Positive</option>
                  <option value="NEUTRAL">Neutral</option>
                  <option value="NEGATIVE">Negative</option>
                </select>
                <select
                  aria-label="Sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as "newest" | "score")}
                  className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                >
                  <option value="score">Strongest first</option>
                  <option value="newest">Newest first</option>
                </select>
                <button
                  type="button"
                  onClick={loadLeads}
                  className="ml-auto rounded-xl p-2 text-gray-500 hover:bg-white"
                  aria-label="Reload list"
                >
                  <RefreshCcw className={`h-4 w-4 ${loadingLeads ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {data && data.leads.length === 0 && !loadingLeads && (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                    <Inbox className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="mt-2 font-semibold text-gray-800">
                      {status === "NEW" ? "No new leads yet" : status === "REPLIED" ? "No replied leads" : "Nothing dismissed"}
                    </p>
                    {status === "NEW" && (
                      <p className="mt-1 text-sm text-gray-500">
                        Press <span className="font-semibold">Get leads</span> to search. Only posts where someone clearly wants to hire, and
                        that match this profile, show up here.
                      </p>
                    )}
                  </div>
                )}
                {data?.leads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} busy={busyLead === lead.id} onUpdate={onUpdate} />
                ))}
              </div>
            </>
          ) : (
            profiles &&
            profiles.length > 0 && <p className="text-sm text-gray-500">Pick a search profile.</p>
          )}
        </section>
      </div>

      {editor && (
        <ProfileEditor
          profile={editor.profile}
          onClose={() => setEditor(null)}
          onSaved={async (saved) => {
            setEditor(null);
            await loadProfiles(saved.id);
          }}
        />
      )}
    </div>
  );
}
