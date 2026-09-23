# Render Keepalive Worker

A tiny Cloudflare Worker with a Cron Trigger that pings the Render-hosted markitdown service every 10 minutes.

## What It Does

- Calls your Render health endpoint on a schedule
- Keeps the Render web service warm between real requests
- Exposes a normal HTTP endpoint too, so you can test it manually

## Files

- `src/index.ts` - Worker code
- `wrangler.toml` - Worker config and cron schedule
- `package.json` - local dev and deploy scripts

## Setup

1. Deploy the markitdown service to Render.
2. Make sure the service responds on:

```text
https://your-render-service.onrender.com/health
```

3. Install dependencies for this Worker:

```bash
cd services/render-keepalive-worker
npm install
```

4. Log into Cloudflare:

```bash
npx wrangler login
```

5. Set the Render healthcheck URL as a Worker secret:

```bash
npx wrangler secret put RENDER_HEALTHCHECK_URL
```

Use the full URL, for example:

```text
https://your-render-service.onrender.com/health
```

6. Deploy the Worker:

```bash
npm run deploy
```

## Schedule

The cron trigger is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["*/10 * * * *"]
```

That pings Render every 10 minutes, which stays below the usual 15-minute inactivity window.

## Manual Test

After deploy, open the Worker URL in a browser or run:

```bash
curl https://your-worker.workers.dev
```

You should get JSON back with the last healthcheck result.

## Notes

- If you want even more cushion, change the schedule to every 5 minutes.
- If you upgrade Render to an always-on paid plan later, you can remove this worker.
