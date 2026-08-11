export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface PlatformRowInput {
  platform: string
  accountName: string
  postedAt: string
  status?: 'published' | 'failed'
}

// Builds the {{ params.platformRows }} HTML block for the "Post Published"
// Brevo template (src/brevo/templates/post-published.html) — one
// .platform-row per connected account that was actually posted to, each
// with its own status and timestamp, instead of one row combining every
// platform into a single "FACEBOOK & X" string.
export function buildPlatformRowsHtml(rows: PlatformRowInput[]): string {
  return rows
    .map(({ platform, accountName, postedAt, status = 'published' }) => {
      const badgeClass = status === 'failed' ? 'status-badge failed' : 'status-badge'
      const statusText = status === 'failed' ? '● Failed' : '● Published'
      return `<div class="platform-row">
        <span class="${badgeClass}">${statusText}</span>
        <span class="platform-account">${escapeHtml(accountName)}</span>
        <span class="platform-network">${escapeHtml(platform.toUpperCase())}</span>
        <div class="platform-time">Posted on ${escapeHtml(postedAt)}</div>
      </div>`
    })
    .join('\n')
}
