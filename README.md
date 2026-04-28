# padel-poll

Polls Project Padel (Galway / Mayo) for available 8pm slots Mon–Thu for the next 21 days.

## Stack

- Next.js 14 (App Router) on Vercel
- A single TypeScript scraping module — no DB, no queues
- Vercel cron for periodic background checks

## How it works

1. `src/lib/padel.ts` GETs `Booking/Grid.aspx?id=<venueId>` to capture the session cookie and the `hl90njda2b89k` token the page bakes into its JS.
2. For each Mon–Thu in the next 21 days, it POSTs the `booking/srvc.aspx/ObtenerCuadro` endpoint with the date and token to get each court's bookings.
3. A slot is "available" if any court has no booking overlapping the target hour (default 20:00–21:00).

Venue IDs: Galway=4, Mayo=5.

## Endpoints

- `/` — server-rendered page. `?venue=galway|mayo`.
- `/api/availability?venue=galway&hour=20` — JSON.
- `/api/cron/check` — invoked by Vercel cron. Logs availability summary; protected by `CRON_SECRET` if set.

## Cron

`vercel.json` runs `/api/cron/check` daily at 09:00 UTC. Edit the cron expression for a different cadence (Vercel Hobby supports any frequency).

To send notifications, extend `src/app/api/cron/check/route.ts` with your channel of choice (e.g. Resend email, Slack webhook, push) — fire when `availableDays > 0`.

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
