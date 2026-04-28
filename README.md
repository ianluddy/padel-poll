# padel-poll

Polls Project Padel Galway for available 8pm slots Mon–Thu for the next 21 days.

## Stack

- Next.js 14 (App Router) on Vercel
- A single TypeScript scraping module — no DB, no queues
- Vercel cron for periodic background checks

## How it works

1. `src/lib/padel.ts` GETs `Booking/Grid.aspx?id=<venueId>` to capture the session cookie and the `hl90njda2b89k` token the page bakes into its JS.
2. For each Mon–Thu in the next 21 days, it POSTs the `booking/srvc.aspx/ObtenerCuadro` endpoint with the date and token to get each court's bookings.
3. A slot is "available" if any court has no booking overlapping the target hour (default 20:00–21:00).

## Endpoints

- `/` — server-rendered page.
- `/api/availability?hour=20` — JSON.
- `/api/cron/check` — invoked by Vercel cron. Logs availability summary; protected by `CRON_SECRET` if set.

## Cron + email notifications

`vercel.json` runs `/api/cron/check` every hour. The handler diffs current availability against the last snapshot in Redis and sends a Resend email listing only **newly opened** slots.

Required env vars (see `.env.example`):

- `RESEND_API_KEY` and `EMAIL_TO` — required for email
- `EMAIL_FROM` — optional; defaults to Resend's test sender (works without domain verification, fine for personal use)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) — required for state. Without these, every run looks like a "first run" and no email is sent.
- `CRON_SECRET` — optional, locks down the cron route

The first run after deploy seeds state without sending an email. Subsequent runs only email when slots that weren't free last hour are free now.

### Provisioning on Vercel

1. **Resend**: sign up, create an API key, add `RESEND_API_KEY` and `EMAIL_TO` to Vercel project env.
2. **Redis**: in the Vercel dashboard, add the Upstash Redis integration (Storage → Marketplace) and link it to the project. Env vars are injected automatically.

## Local dev

```sh
npm install
npm run dev
```

## Deploy

```sh
vercel deploy
```

Optionally set `CRON_SECRET` in Vercel project env to lock down the cron endpoint.
