# Logo Overlay API

Backend implementation for the Templates page "apply your logo" feature. Three endpoints, no authentication required on any of them. Source: `src/logo-overlay/`.

All routes are under the app's global prefix: `/api`.

---

## 1. Upload Logo

Uploads a logo image and returns a hosted URL that `POST /api/templates/apply-logo` can reference.

```
POST /api/logo/upload
Content-Type: multipart/form-data
Authorization: none
```

### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `file` | file | **Required** | PNG, JPG, SVG, or WEBP. Max 5MB. |

There is nothing optional about this endpoint — it takes exactly one field.

### Response — `200 OK`

```json
{
  "logoId": "b2e79df3-1650-4470-a3e0-96c455a616e1",
  "logoUrl": "https://i.ibb.co/xxxxxxx/xxxx.png",
  "width": 128,
  "height": 128
}
```

- `logoId` — a random token for the frontend to key off of. Not looked up server-side anywhere; `apply-logo` takes `logoUrl` directly, not `logoId`.
- `logoUrl` — permanent public URL (hosted on ImgBB). Pass this straight into `apply-logo`.
- `width` / `height` — pixel dimensions read from the uploaded file. `0` if unreadable (rare, e.g. some malformed SVGs) — non-fatal.

### Errors

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "message": "No file provided" }` | `file` field missing |
| `400` | `{ "message": "Unsupported file type. Use PNG, JPG, SVG, or WEBP." }` | mimetype not in the allowed set |
| `413` | `{ "message": "File too large. Max 5MB." }` | file exceeds 5MB |

### Example

```bash
curl -X POST http://localhost:3000/api/logo/upload \
  -F "file=@/path/to/logo.png"
```

---

## 2. Upload Template

Uploads a background/template image and returns a hosted URL that `POST /api/templates/apply-logo` can use as `templateImageUrl`. Lets a user bring their own background instead of only picking from the built-in template library.

```
POST /api/templates/upload
Content-Type: multipart/form-data
Authorization: none
```

### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `file` | file | **Required** | PNG, JPG, SVG, or WEBP. Max 5MB. |

Same validation and error responses as `POST /api/logo/upload` above (`400` no file / unsupported type, `413` too large) — it's the identical upload pipeline (`ImgbbService`), just labeled for templates instead of logos.

### Response — `200 OK`

```json
{
  "templateId": "ea9202f8-ec4d-407c-8c1b-f793dda2370a",
  "templateUrl": "https://i.ibb.co/xxxxxxx/xxxx.jpg",
  "width": 800,
  "height": 930
}
```

- `templateId` — a random token for the frontend to key off of, same as `logoId` on the upload-logo endpoint. Not looked up server-side anywhere.
- `templateUrl` — pass this straight into `apply-logo`'s `templateImageUrl` field.

### Example

```bash
curl -X POST http://localhost:3000/api/templates/upload \
  -F "file=@/path/to/background.jpg"
```

Verified end-to-end: uploaded a real JPG, got back a `templateUrl`, fed it into `apply-logo` as `templateImageUrl`, and the resulting render correctly used the uploaded image as its background.

---

## 3. Apply Logo Overlay (render)

Composites a template background image with an optional logo + branding badge and/or bottom bar, per the style controls below, and returns short-lived access to the result — **not** a permanent public URL (see [Access model](#access-model) below).

```
POST /api/templates/apply-logo
Content-Type: application/json
Authorization: none
```

### Request body

```json
{
  "templateImageUrl": "https://images.shoutlyai.com/templates/gym-motivation.jpg",
  "logoUrl": "https://i.ibb.co/xxxxxxx/xxxx.png",

  "position": "tl",
  "logoSize": 48,
  "badgeStyle": "glass",
  "opacity": 90,
  "blur": 12,
  "radius": 10,
  "primaryColor": "#F97316",
  "textColor": "white",

  "brandName": "Sunset Yoga Studio",
  "phone": "+1 (555) 000-0000",
  "overlayText": "sunsetyogastudio.com",

  "showBadge": true,
  "showLogo": true,
  "showName": true,
  "showContact": true,
  "showOvtext": true,
  "showCorner": false,
  "showTextbar": false
}
```

### Field reference — required vs. optional

Every field below must be present **except** the three marked optional. There are no server-side defaults — a missing required field is a `400`.

| Field | Type | Required? | Values / range | Effect if omitted (only applies to the 3 optional fields) |
|---|---|---|---|---|
| `templateImageUrl` | string (URL) | **Required** | any fetchable image URL — from the built-in template library, or the `templateUrl` returned by `POST /api/templates/upload` above | — |
| `logoUrl` | string (URL) | Optional | any fetchable image URL | No logo in the badge — text-only badge (or no badge at all if no text is shown either) |
| `position` | string | **Required** | `"tl"` \| `"tr"` \| `"bl"` \| `"br"` | — |
| `logoSize` | number | **Required** | `24`–`80` | — |
| `badgeStyle` | string | **Required** | `"glass"` \| `"solid"` \| `"outline"` \| `"minimal"` | — |
| `opacity` | number | **Required** | `20`–`100` | — |
| `blur` | number | **Required** | `0`–`24` | — |
| `radius` | number | **Required** | `0`–`28` | — |
| `primaryColor` | string (hex) | **Required** | `#RRGGBB` | — |
| `textColor` | string | **Required** | `"white"` \| `"dark"` | — |
| `brandName` | string | Optional | — | That line just doesn't render (in either the badge or the bottom bar) |
| `phone` | string | Optional | — | That line just doesn't render |
| `overlayText` | string | Optional | — | That line just doesn't render |
| `showBadge` | boolean | **Required** | — | Gates the **badge container** only — see [Show Branding As](#show-branding-as-badge--bottom-bar--both) below |
| `showLogo` | boolean | **Required** | — | `false` suppresses the logo even if `logoUrl` is set |
| `showName` | boolean | **Required** | — | `false` suppresses `brandName` even if set (in both the badge and the bar) |
| `showContact` | boolean | **Required** | — | `false` suppresses `phone` even if set (in both the badge and the bar) |
| `showOvtext` | boolean | **Required** | — | `false` suppresses `overlayText` even if set (in both the badge and the bar) |
| `showCorner` | boolean | **Required** | — | `false` = no corner bracket |
| `showTextbar` | boolean | **Required** | — | Gates the **bottom bar container** only — see below |

**All style/toggle fields (`position` through `showTextbar`) are required on every request** — the frontend's sliders and pickers always have a value, so there's no "unset" state to default to. If you turn off every visible element (`showBadge: false`, `showTextbar: false`), the response still succeeds — you just get the plain template image back.

`primaryColor` is required even if nothing that uses it is shown (badge, corner accent, bottom bar all read from it) — it's just unused visually in that case.

### Show Branding As: Badge / Bottom Bar / Both

The frontend's "Show Branding As" control maps directly onto two independent container flags:

| Frontend selection | `showBadge` | `showTextbar` |
|---|---|---|
| Badge | `true` | `false` |
| Bottom Bar | `false` | `true` |
| Both | `true` | `true` |

`showLogo` / `showName` / `showContact` / `showOvtext` are **content** flags, not container flags — they control which fields appear, and they drive both containers identically. `showBadge` and `showTextbar` are separate, independent switches for whether each *container* is drawn at all. This split matters because the two containers don't have a 1:1 relationship with the content flags: without it, there'd be no way to show text in the bottom bar while suppressing the badge (or vice versa), since both containers would try to read from the same booleans. With `showBadge`/`showTextbar` as separate gates, all three modes work with the same content flags sent unchanged — only the two container flags need to flip.

### Rendering behavior

- Output is always a **500×500 PNG**, template image cover-cropped to fill the square.
- Badge renders in the corner given by `position`, only if `showBadge` is true AND at least one of: a shown logo, `showName`+`brandName`, `showContact`+`phone`, `showOvtext`+`overlayText`.
- Badge fill/border depends on `badgeStyle` (`glass`/`solid`/`outline`/`minimal`), tinted by `primaryColor`, at `opacity`% overall.
- `blur` applies a **real** backdrop blur behind the badge (only meaningful for `glass`/`outline`, where the badge fill is translucent).
- `showTextbar` draws a full-width bottom gradient bar with `brandName`/`phone`/`overlayText` (whichever are shown and non-empty) joined by `"  ·  "`, independent of whether the badge is shown.
- `showCorner` draws a 44×44px L-bracket accent in the `position` corner, independent of both `showBadge` and `showTextbar`.

### Response — `200 OK`

```json
{
  "renderId": "cb1c3462-e58e-4714-a990-319fdfd21ded",
  "downloadToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 1800,
  "previewUrl": "/api/templates/render/cb1c3462-e58e-4714-a990-319fdfd21ded?token=eyJhbGciOiJIUzI1NiIs...",
  "downloadUrl": "/api/templates/render/cb1c3462-e58e-4714-a990-319fdfd21ded/download?token=eyJhbGciOiJIUzI1NiIs...",
  "width": 500,
  "height": 500,
  "createdAt": "2026-08-23T21:33:55.599Z"
}
```

There is **no raw/public image URL in this response** — see below.

### Errors

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "message": [...] }` | a required field is missing or fails validation (class-validator messages) |
| `422` | `{ "message": "Could not fetch logoUrl or templateImageUrl" }` | either URL couldn't be fetched |
| `500` | `{ "message": "Render failed" }` | unexpected compositing/upload failure |

### Example

```bash
curl -X POST http://localhost:3000/api/templates/apply-logo \
  -H "Content-Type: application/json" \
  -d '{
    "templateImageUrl": "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800",
    "logoUrl": "https://i.ibb.co/xxxxxxx/xxxx.png",
    "position": "tl", "logoSize": 48, "badgeStyle": "glass",
    "opacity": 90, "blur": 12, "radius": 10,
    "primaryColor": "#F97316", "textColor": "white",
    "brandName": "Sunset Yoga Studio", "phone": "+1 (555) 000-0000", "overlayText": "sunsetyogastudio.com",
    "showBadge": true, "showLogo": true, "showName": true, "showContact": true, "showOvtext": true,
    "showCorner": false, "showTextbar": false
  }'
```

---

## Access model

`apply-logo` does **not** return a permanent public link to the rendered image (that would let anyone who sees the response, or the network request, download the file forever with no way to revoke it). Instead, it returns a **short-lived signed token** scoped to that one render, and two routes that require it:

```
GET /api/templates/render/:renderId?token=...          → inline (image/png) — for <img src="..."> preview
GET /api/templates/render/:renderId/download?token=...  → same image, Content-Disposition: attachment
```

- The token is a JWT signed with the app's `JWT_SECRET`, valid for **30 minutes** (`expiresIn` in the response, in seconds), and only usable for the exact `renderId` it was issued for.
- The actual storage URL (ImgBB) is stored server-side (Redis, same TTL) and is **never sent to the client** in any response or token payload — the JWT only carries `{ purpose, renderId }`, so decoding it reveals nothing usable.
- Both routes return `403` for a missing/invalid/expired/mismatched token, or if the underlying Redis entry has expired.
- The `/download` variant additionally sets `Content-Disposition: attachment`, so browsers save the file instead of opening it inline.

**Frontend integration:**
- Live preview / checkout screen: `<img src="{previewUrl}">` — `previewUrl` is already a full relative path with the token attached, just prefix with your API host.
- "Download" button: navigate to or `window.location = downloadUrl` — same deal.
- Don't persist `downloadToken` past its 30-minute window; if a user comes back later, they need a fresh `apply-logo` call.

**What this does and doesn't protect against:** it stops the raw storage link from being exposed or shared indefinitely, and stops a plain `curl`/network-tab copy of the *old-style* response from working after 30 minutes. It cannot stop someone from screenshotting an image that's already rendered on their screen, or from re-downloading via the button as many times as they want within the token's lifetime — no backend change can prevent either of those.

---

## Known limitations / open items

- **Redis dependency**: the render→URL mapping lives in Redis with a 30-minute TTL (`RedisService`, already used elsewhere in this app). If Redis is unreachable, both `apply-logo` and the render/download routes will fail.
- **No payment/order gating**: the 30-minute token window is the only access control. There's no check against a completed checkout — if that's needed later, swap the Redis TTL check in `ApplyLogoService.streamRender` for an order-status lookup.
- **No rate limiting** on either endpoint — intentionally deferred (see original feature doc); add `@nestjs/throttler` if abuse becomes a concern.
- Anonymous by design — matches the frontend's pre-signup customize flow. Add an `AuthGuard` if that changes.
