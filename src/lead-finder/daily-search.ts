import { RedisService } from '../common/redis/redis.service'

// One successful "Get leads" per user per UTC day (admins: no limit), same
// day boundary as Website Analysis. A failed search doesn't count, so the
// user can try again until one succeeds. The leads themselves are saved in
// Postgres, so the user can come back and view them any time.

/** When the user's last successful search finished. Kept with no expiry, for "Last searched". */
const lastSearchKey = (userId: string) => `lf:lastsearch:${userId}`

const utcDay = (date: Date) => date.toISOString().slice(0, 10)

export interface DailySearchState {
  lastSearchedAt: string | null
  /** null = no limit (admin) */
  searchesLeftToday: number | null
}

/** Fails open: if Redis is down the search is allowed rather than blocking everyone. */
export async function readDailySearch(redis: RedisService, userId: string, isAdmin: boolean): Promise<DailySearchState> {
  let lastSearchedAt: string | null = null
  try {
    const value = await redis.getClient().get(lastSearchKey(userId))
    lastSearchedAt = value ? String(value) : null
  } catch {
    lastSearchedAt = null
  }
  if (isAdmin) return { lastSearchedAt, searchesLeftToday: null }
  const usedToday = !!lastSearchedAt && utcDay(new Date(lastSearchedAt)) === utcDay(new Date())
  return { lastSearchedAt, searchesLeftToday: usedToday ? 0 : 1 }
}

/** Called only when a search succeeded. */
export async function recordDailySearch(redis: RedisService, userId: string, at = new Date()): Promise<string> {
  const iso = at.toISOString()
  try {
    await redis.getClient().set(lastSearchKey(userId), iso)
  } catch {
    // The limit fails open; the search itself already succeeded.
  }
  return iso
}

/**
 * A search still running in the background. Kept so it is counted even if
 * the user closes the page before it finishes (nobody is polling then).
 */
const pendingSearchKey = (userId: string) => `lf:pendingsearch:${userId}`

export interface PendingSearch {
  jobIds: string[]
  startedAt: string
}

export async function setPendingSearch(redis: RedisService, userId: string, jobIds: string[]): Promise<void> {
  try {
    const value: PendingSearch = { jobIds, startedAt: new Date().toISOString() }
    await redis.getClient().set(pendingSearchKey(userId), JSON.stringify(value), { EX: 2 * 24 * 60 * 60 })
  } catch {
    // Fails open, like the limit itself.
  }
}

export async function takePendingSearch(redis: RedisService, userId: string): Promise<PendingSearch | null> {
  try {
    const client = redis.getClient()
    const value = await client.get(pendingSearchKey(userId))
    if (!value) return null
    await client.del(pendingSearchKey(userId))
    return JSON.parse(String(value)) as PendingSearch
  } catch {
    return null
  }
}
