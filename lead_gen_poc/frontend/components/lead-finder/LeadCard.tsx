"use client";

import { useState } from "react";
import {
  ArrowUpRight, Ban, Check, Clock, MessageCircle, RotateCcw, ThumbsDown, TriangleAlert, X,
} from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/api/leadFinderApi";
import { PLATFORM_LABEL, PLATFORM_PILL, SENTIMENT_STYLE, scoreTone, timeAgo } from "./format";

interface Props {
  lead: Lead;
  busy: boolean;
  onUpdate: (lead: Lead, patch: { status?: LeadStatus; notALead?: boolean }) => void;
}

function Meter({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-gray-500">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${scoreTone(value)}`} style={{ width: `${Math.max(4, value)}%` }} />
      </div>
    </div>
  );
}

export default function LeadCard({ lead, busy, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { post } = lead;
  const sentiment = SENTIMENT_STYLE[post.sentiment];
  const where = post.source ? (post.platform === "REDDIT" ? `r/${post.source}` : post.source) : null;
  const heading = post.title || post.summary || post.snippet.slice(0, 90);

  return (
    <article className="rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gray-500">
        <span className={`rounded-md px-2 py-0.5 font-semibold ring-1 ${PLATFORM_PILL[post.platform]}`}>
          {PLATFORM_LABEL[post.platform]}
        </span>
        {where && <span className="font-medium text-gray-700">{where}</span>}
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {timeAgo(post.postedAt)}
        </span>
        {post.author && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">
              {post.platform === "REDDIT" ? `u/${post.author}` : post.author}
            </span>
          </>
        )}
        {lead.isStale && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
            <TriangleAlert className="h-3.5 w-3.5" />
            Older post, may be outdated
          </span>
        )}
      </div>

      <h3 className="font-heading mt-2.5 text-[17px] font-semibold leading-snug text-gray-900">{heading}</h3>

      {post.need && (
        <p className="mt-2 text-sm text-gray-800">
          <span className="font-semibold text-orange-600">Needs: </span>
          {post.need}
        </p>
      )}

      <p className={`mt-2 text-sm leading-relaxed text-gray-600 ${expanded ? "" : "line-clamp-3"}`}>{post.snippet}</p>
      {post.snippet.length > 200 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-semibold text-gray-500 hover:text-gray-800"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Meter label="Intent" value={lead.score} hint="How clearly the poster wants to hire or buy (0-100)" />
        <Meter label="Match" value={lead.relevance} hint="How well the need matches this profile's keywords (0-100)" />
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${sentiment.pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${sentiment.dot}`} />
            {sentiment.label}
          </span>
        </div>
      </div>
      {post.sentimentReason && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Tone: </span>
          {post.sentimentReason}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Open post <ArrowUpRight className="h-4 w-4" />
        </a>

        {lead.status === "NEW" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(lead, { status: "REPLIED" })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Mark replied
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(lead, { status: "DISMISSED" })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Dismiss
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(lead, { notALead: true })}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
            >
              <ThumbsDown className="h-4 w-4" /> Not a real lead
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
              {lead.notALead ? (
                <><Ban className="h-4 w-4" /> Marked not a real lead</>
              ) : lead.status === "REPLIED" ? (
                <><MessageCircle className="h-4 w-4" /> Replied</>
              ) : (
                <><X className="h-4 w-4" /> Dismissed</>
              )}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(lead, { status: "NEW", notALead: false })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E7EB] px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> Move back to New
            </button>
          </>
        )}

        {lead.profiles.length > 0 && (
          <span className="ml-auto hidden truncate text-xs text-gray-400 sm:inline">
            Matched: {lead.profiles.map((p) => p.name).join(", ")}
          </span>
        )}
      </div>
    </article>
  );
}
