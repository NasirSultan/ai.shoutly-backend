import type { LeadPlatform, LeadSentiment } from "@/lib/api/leadFinderApi";

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown time";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const PLATFORM_LABEL: Record<LeadPlatform, string> = {
  REDDIT: "Reddit",
  FACEBOOK: "Facebook",
};

export const PLATFORM_PILL: Record<LeadPlatform, string> = {
  REDDIT: "bg-[#FF4500]/10 text-[#C2410C] ring-[#FF4500]/25",
  FACEBOOK: "bg-[#1877F2]/10 text-[#1D4ED8] ring-[#1877F2]/25",
};

export const SENTIMENT_STYLE: Record<LeadSentiment, { label: string; pill: string; dot: string }> = {
  POSITIVE: { label: "Positive", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  NEUTRAL: { label: "Neutral", pill: "bg-gray-100 text-gray-700 ring-gray-200", dot: "bg-gray-400" },
  NEGATIVE: { label: "Negative", pill: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
};

/** Orange for strong, amber for medium, grey for weak: same scale for intent and relevance. */
export function scoreTone(score: number): string {
  if (score >= 75) return "bg-orange-500";
  if (score >= 50) return "bg-amber-400";
  return "bg-gray-300";
}
