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
- `/api/calendar` — ICS feed of currently upcoming sessions, for subscribing from Google Calendar. Protected by `CALENDAR_FEED_TOKEN` (as a `?token=` query param) if set.

## Cron + email notifications

`vercel.json` runs `/api/cron/check` every 30 minutes. The handler diffs current availability against the last snapshot in Redis and sends a Resend email listing only **newly opened** slots.

Required env vars (see `.env.example`):

- `RESEND_API_KEY` and `EMAIL_TO` — required for email
- `EMAIL_FROM` — optional; defaults to Resend's test sender (works without domain verification, fine for personal use)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) — required for state. Without these, every run looks like a "first run" and no email is sent.
- `CRON_SECRET` — optional, locks down the cron route

The first run after deploy seeds state without sending an email. Subsequent runs only email when slots that weren't free last check are free now.

If any per-date fetch fails or the session can't be established, the cron sends a separate failure email and **does not** update the snapshot — so a partial run won't manufacture spurious "new opening" notifications on the next successful run.

### Provisioning on Vercel

1. **Resend**: sign up, create an API key, add `RESEND_API_KEY` and `EMAIL_TO` to Vercel project env.
2. **Redis**: in the Vercel dashboard, add the Upstash Redis integration (Storage → Marketplace) and link it to the project. Env vars are injected automatically.

## Google Calendar sync

`/api/calendar` serves an ICS feed built fresh on every request from the cached
upcoming-sessions list, so a cancelled booking simply stops appearing in it.
Each event's description lists the confirmed players (🎾) and any open slots.

To subscribe: Google Calendar → Settings → **Add calendar** → **From URL**, and
paste `https://<your-deployment>/api/calendar` (append `?token=...` if you set
`CALENDAR_FEED_TOKEN`). Google only re-polls external ICS URLs every 12–24
hours or so, so calendar updates (new bookings, cancellations) can lag behind
the WhatsApp/email notifications by up to a day.

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
