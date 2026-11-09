import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "./configApi";
import { ApiError } from "./apiError";

/* ──────────────────────────────────────────────────────────────
   AXIOS CLIENT (Bearer token, same as Shoutly's websiteWatcherApi)
   The POC backend has no sign-in and ignores the header; inside
   Shoutly the same client authenticates with the user's token.
────────────────────────────────────────────────────────────── */
const client = axios.create({ baseURL: `${API_BASE_URL}/api`, timeout: 30_000 });

client.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("shoutly_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function toApiError(err: unknown): ApiError {
  const e = err as AxiosError<{ message?: string | string[] }>;
  const raw = e.response?.data?.message;
  const message = Array.isArray(raw) ? raw.join(", ") : raw || e.message || "Something went wrong";
  return new ApiError(message, e.response?.status ?? 0);
}

async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data;
  } catch (err) {
    throw toApiError(err);
  }
}

/* ──────────────────────────────────────────────────────────────
   TYPES
────────────────────────────────────────────────────────────── */
export type LeadPlatform = "REDDIT" | "FACEBOOK";
export type LeadStatus = "NEW" | "REPLIED" | "DISMISSED";
export type LeadSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";
export type LeadClassification = "GENUINE_LEAD" | "TANGENTIAL_MENTION" | "DISCUSSION_ONLY";

export interface SearchProfile {
  id: string;
  name: string;
  websiteUrl: string | null;
  summary: string | null;
  keywords: string[];
  subreddits: string[];
  exclusions: string[];
  platforms: LeadPlatform[];
  active: boolean;
  createdAt: string;
}

export type SearchProfileInput = Pick<
  SearchProfile,
  "name" | "keywords" | "subreddits" | "exclusions" | "platforms"
> & { websiteUrl?: string; summary?: string };

export interface WebsiteAnalysis {
  suggestedName: string;
  summary: string;
  keywords: string[];
  subreddits: string[];
  exclusions: string[];
}

export interface CrawlJob {
  jobId: string;
  url: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  result: WebsiteAnalysis | null;
  error: string | null;
  mocked?: boolean;
}

export interface PlatformFetchState {
  platform: LeadPlatform;
  status: "ready" | "pending";
  jobId: string | null;
  lastFetchedAt: string | null;
}

export interface FetchResponse {
  profileId: string;
  status: "ready" | "pending";
  platforms: PlatformFetchState[];
}

export interface FetchJobStatus {
  jobId: string;
  platform: LeadPlatform;
  state: "running" | "completed" | "failed";
  error?: string;
  outdated?: boolean;
  leadsAdded?: number;
  lastFetchedAt?: string;
  result?: { fetched: number; newPosts: number; classified: number; genuineLeads: number; unclassified: number } | null;
}

export interface Lead {
  id: string;
  status: LeadStatus;
  notALead: boolean;
  /** Intent score 0-100 */
  score: number;
  /** Relevance 0-100 to the profile's keywords */
  relevance: number;
  createdAt: string;
  isStale: boolean;
  profiles: { id: string; name: string }[];
  post: {
    platform: LeadPlatform;
    source: string | null;
    title: string | null;
    snippet: string;
    author: string | null;
    url: string;
    postedAt: string | null;
    platformScore: number;
    commentCount: number;
    classification: LeadClassification;
    intentScore: number;
    sentiment: LeadSentiment;
    sentimentReason: string | null;
    summary: string | null;
    need: string | null;
  };
}

export interface LeadList {
  page: number;
  pageSize: number;
  total: number;
  statusCounts: Record<LeadStatus, number>;
  leads: Lead[];
}

export interface LeadFilters {
  status?: LeadStatus;
  platform?: LeadPlatform;
  sentiment?: LeadSentiment;
  profileId?: string;
  sort?: "newest" | "score";
  page?: number;
}

/* ──────────────────────────────────────────────────────────────
   SEARCH PROFILES  (/api/search-profiles)
────────────────────────────────────────────────────────────── */
export const startWebsiteAnalysis = (url: string) =>
  call<CrawlJob>(() => client.post("/search-profiles/crawl", { url }));

export const getWebsiteAnalysis = (jobId: string) =>
  call<CrawlJob>(() => client.get(`/search-profiles/crawl/${jobId}`));

export const listSearchProfiles = () => call<SearchProfile[]>(() => client.get("/search-profiles"));

export const createSearchProfile = (input: SearchProfileInput) =>
  call<SearchProfile>(() => client.post("/search-profiles", input));

export const updateSearchProfile = (id: string, input: Partial<SearchProfileInput>) =>
  call<SearchProfile>(() => client.patch(`/search-profiles/${id}`, input));

export const deleteSearchProfile = (id: string) =>
  call<{ deleted: boolean }>(() => client.delete(`/search-profiles/${id}`));

/* ──────────────────────────────────────────────────────────────
   LEADS  (/api/lead-finder)
────────────────────────────────────────────────────────────── */
export const requestLeads = (profileId: string) =>
  call<FetchResponse>(() => client.post("/lead-finder/fetch", { profileId }));

export const getFetchStatus = (jobId: string, profileId: string) =>
  call<FetchJobStatus>(() => client.get(`/lead-finder/fetch/${jobId}`, { params: { profileId } }));

export const listLeads = (filters: LeadFilters) =>
  call<LeadList>(() => client.get("/lead-finder/leads", { params: filters }));

export const updateLead = (id: string, patch: { status?: LeadStatus; notALead?: boolean }) =>
  call<Lead>(() => client.patch(`/lead-finder/leads/${id}`, patch));
