# ShoutyAI Backend

A NestJS REST API backend for ShoutyAI — a social media scheduling and content generation platform.

## Run & Operate

- **Dev build**: `npm run build` then `bash start.sh` (starts Redis + Node)
- **Watch mode**: `npm run start:dev` (requires Redis running separately)
- **Prisma generate**: `npm run prisma:generate`
- **DB schema push**: `npx prisma db push`

Required env vars:
- `DATABASE_URL` — PostgreSQL (provisioned by Replit)
- `REDIS_URL` — `redis://localhost:6379` (local Redis)
- `JWT_SECRET` — JWT signing secret
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` — Email via Brevo/Sendinblue
- `GOOGLE_API_KEY` — Gemini AI text/image generation
- `GOOGLE_CLIENT_ID` — Google OAuth login
- `FB_APP_ID`, `FB_APP_SECRET`, `FB_REDIRECT_URI` — Facebook OAuth
- `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` — Image hosting
- `IMGBB_KEY` — Alternative image upload
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_BUCKET_NAME`, `AWS_REGION` — S3 for reels

## Stack

- **Runtime**: Node.js 20
- **Framework**: NestJS 10
- **ORM**: Prisma 6 with PostgreSQL
- **Queue**: BullMQ + IORedis (local Redis)
- **Email**: Brevo (Sendinblue)
- **AI**: Google Gemini via `@google/genai`
- **Storage**: ImageKit + AWS S3

## Where things live

- `src/` — all application source
- `src/main.ts` — entry point, listens on `0.0.0.0:PORT`
- `src/app.module.ts` — root module composition
- `src/auth/` — JWT auth + Google OAuth
- `src/social-media/facebook/` — Facebook OAuth + posting
- `src/jobs/` — BullMQ queue + worker for scheduled posts
- `src/industries/` — industry/sub-industry content management
- `src/calendar/` — content calendar planning
- `src/geminiimage/` — AI post generation
- `src/imagelayout/` — image compositing with ImageKit
- `prisma/schema.prisma` — DB schema source of truth
- `start.sh` — startup script (daemonizes Redis, runs Node)

## Architecture decisions

- Redis runs locally (daemonized) to power BullMQ job queues for social media post scheduling
- Services with missing API keys (Brevo, ImageKit, AWS S3) are initialized lazily/conditionally to avoid crash on startup
- `DIRECT_URL` removed from Prisma schema — Replit DB only needs `DATABASE_URL`
- App listens on `0.0.0.0` (not `localhost`) for Replit proxy compatibility
- VM deployment target used (not autoscale) because Redis state and BullMQ workers must persist across requests

## Product

- User registration/login with OTP email verification and Google OAuth
- Multi-industry content library with sub-industries, images, reels, and text content
- AI-powered social media post generation via Google Gemini
- Content calendar: schedule and plan posts across social platforms
- Facebook integration: OAuth connect, page management, scheduled posting via BullMQ
- Image layout composer: overlay logos and text on images via ImageKit
- Subscription management (Starter/Growth plans, monthly/yearly billing)

## Gotchas

- Redis must be running before the NestJS server starts (`start.sh` handles this)
- Without `BREVO_API_KEY`, email features (OTP, notifications) are disabled at runtime
- Without ImageKit keys, `imagelayout` endpoints will fail at request time (not startup)
- AWS keys required only for reel uploads; missing keys don't crash startup
