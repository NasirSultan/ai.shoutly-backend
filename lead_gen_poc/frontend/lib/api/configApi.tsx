// Same export as Shoulty-Ai/lib/api/configApi.tsx. After integration, delete
// this file and import API_BASE_URL from Shoutly's configApi instead.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4100";
