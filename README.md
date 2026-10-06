# SaveHA backend

API for SaveHA, built with Node.js, Express 5 and TypeScript.

Its main feature downloads sailing schedules from [Ocean Network Express (ONE)](https://www.one-line.com) with a headless Chrome (Puppeteer) and returns them as a CSV, laid out one row per week and one column per service.

## Requirements

- Node.js 22 or later
- About 300 MB of disk space for the Chrome build that Puppeteer downloads on install
- Internet access to `www.one-line.com`

## Installation

```bash
git clone https://github.com/t0dida00/saveHA-backend.git
cd saveHA-backend
npm install            # also downloads Chrome for Puppeteer
cp .env.example .env
npm run dev            # http://localhost:4000/api/v1/health
```

If Chrome didn't download (for example because `PUPPETEER_SKIP_DOWNLOAD` is set), install it with:

```bash
npx puppeteer browsers install chrome
```

**Linux servers and Docker:** Chrome needs extra system libraries (`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2` and others). See [Puppeteer's troubleshooting guide](https://pptr.dev/troubleshooting).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload (tsx watch) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm test` | Run tests (Vitest + Supertest); they mock ONE, so no network is needed |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | Type-check without emitting |

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production` or `test` |
| `PORT` | `4000` | Port the API listens on |
| `CRON_SECRET` | unset | Bearer token `GET /schedules/one/weekly/cron` requires. Unset means anyone can call it |
| `BLOB_READ_WRITE_TOKEN` | unset | Vercel Blob token for saving and reading the cron's CSV. Vercel adds it when you connect a Blob store |
| `HF_TOKEN` | unset | Hugging Face access token for `POST /chat` ([create one](https://huggingface.co/settings/tokens) with the "Make calls to Inference Providers" permission). Unset means `/chat` returns 503 |
| `HF_MODEL` | `openai/gpt-oss-120b` | Chat model on Hugging Face Inference Providers. It must support tool calling ([list](https://huggingface.co/inference/models)) |

**Locally, don't set `BLOB_STORE_ID`.** If it's set and the Vercel CLI is logged in, `@vercel/blob` signs in with OIDC instead of `BLOB_READ_WRITE_TOKEN`. Vercel only allows that in production, so reads fail with 403 and saves with `BlobOidcEnvironmentNotAllowedError`.

Values are validated at startup in `src/config/env.ts`. If one is invalid, the server exits with a message saying which.

## API

All routes are under `/api/v1`. Errors are JSON: `{ "error": "...", "details": { ... } }`.

### `GET /health`

Returns `{ "status": "ok", "uptime": 12, "timestamp": "..." }`.

### `POST /schedules/one/weekly`

Downloads several services from ONE and returns one CSV with a column per service. Takes about 1 minute for 8 services, because each one opens its own Chrome page (3 run at a time).

Request body (every field is optional):

```json
{
  "date": "2026-10-06",
  "next": 8,
  "services_routes": {
    "PS3": { "from": "VNCMP", "to": "USLAX" },
    "PS7": { "from": "VNHPH", "to": "USLAX" }
  }
}
```

| Field | Values | Default |
|---|---|---|
| `date` | First departure date, `YYYY-MM-DD` | today |
| `next` | Weeks to search: `2`, `4`, `6` or `8` | `8` |
| `services_routes` | `"all"`, or an object of service code → `{ from, to }` | `"all"` |

`"all"` uses the default list in `src/modules/schedules/oneServices.ts`. `from` and `to` must be locations listed in `src/modules/schedules/oneLocations.ts`.

The response is a CSV file named `ONE-ddmmyyyy.csv`:

| ONE | PS7 (HPH/VUT - LAX/LGB/OAK) | PS3 (VUT/HPH - LAX/LGB/OAK) |
|---|---|---|
| QueryString | ONE search URL | ONE search URL |
| W41/2026 05/10-11/10 | WAN HAI A03 E018/ OCT 08 | NYK VEGA 088E/ OCT 10 |
| W42/2026 12/10-18/10 | HYUNDAI NEPTUNE 046E/ OCT 15 | OMIT |

- **QueryString** links to ONE's search page for that column's route.
- **Week rows** are ISO weeks (Monday–Sunday), from the week of `date` to the week of the last sailing found. Each cell is `VESSEL VOYAGE/ MON DD`, using the departure date from the origin.
- **OMIT** means no sailing that week.
- **N/A** means ONE doesn't run that service on that route.
- **ERROR** means the download failed twice. The server log has the reason.

### `GET /schedules/one/weekly/latest`

The CSV saved by the last cron run (see below), as a file named `ONE-ddmmyyyy.csv` after the date it was scraped. Answers in under a second, compared with about 1 minute for `POST /schedules/one/weekly`. Returns 404 until the cron has run once.

### `GET /schedules/one/weekly/cron`

Called by Vercel Cron, not the frontend. Runs `POST /schedules/one/weekly` with today's date, `next: 8` and `services_routes: "all"`, then saves the CSV to Vercel Blob:

- `schedules/one-weekly/latest.json`: the newest run, overwritten each time. `/latest` reads this.
- `schedules/one-weekly/history/ONE-ddmmyyyy.csv`: a dated copy of every run.

The blobs are private. When `CRON_SECRET` is set, requests need `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends automatically. Responds `{ "saved": "ONE-06102026.csv" }`.

### `GET /schedules/one/healthCheck`

Called by Vercel Cron every 3 days to check that scraping ONE still works. It scrapes one service (PS3, Cai Mep → Los Angeles) for 2 weeks from today and saves only the verdict, to `schedules/one-health/latest.json` in Vercel Blob. Takes about 15 seconds.

Returns `200` with `"alive": true` when sailings come back, and `503` with `"alive": false` when none do, so the run shows as failed in Vercel's cron logs. The server log says why. `url` is the ONE search it ran and `seconds` how long it took. Needs the same `CRON_SECRET` header as the weekly cron.

```json
{ "alive": true, "url": "https://www.one-line.com/...", "seconds": 12 }
```

### `GET /schedules/one/healthCheck/latest`

The verdict of the last health check, for the frontend's status dot. Public and instant: it reads the saved result and never scrapes. Returns 404 until the health check has run once.

```json
{ "alive": true, "checkedAt": "2026-10-06T02:00:12.000Z", "seconds": 12 }
```

### `GET /schedules/one/p2p`

The same layout for a single service and route, or ONE's original xlsx file.

| Query param | Default | Notes |
|---|---|---|
| `origin` / `destination` | `VNHPH` / `USLAX` | UN/LOCODEs |
| `originName` / `destinationName` | from `oneLocations.ts` | Needed for codes not listed there, spelled exactly as ONE does |
| `service` | `PS7` | An unknown code returns 404 with the services available on the route |
| `from` | today | `YYYY-MM-DD` |
| `weeks` | `8` | 1–8 |
| `format` | `csv` | `xlsx` returns ONE's original export |

The file is named `ONE-HPH-LAX-ddmmyyyy.csv`.

### `POST /chat`

A chatbot that answers questions about the last 3 schedules the Saturday cron saved, for example:

- "How many voyages does MS2 have?"
- "List the voyages of PS3."
- "Are there any differences between the last 2 files?"

Request body: the whole conversation so far, ending with the user's question. The server keeps no state, so send earlier turns again to ask follow-up questions. Up to 20 messages of up to 2,000 characters each.

```json
{
  "messages": [
    { "role": "user", "content": "How many voyages does MS2 have?" }
  ]
}
```

Response, where `files` lists the schedules the answer used, newest first:

```json
{
  "answer": "**MS2** – 10 voyages (newest schedule)\n\n- HMM GAON 024E – Oct 09\n- ...",
  "files": ["ONE-06102026.csv", "ONE-05102026.csv"]
}
```

`answer` is Markdown. Takes about 2–10 seconds. Errors: `404` before the cron has saved a file, `503` without `HF_TOKEN`, `502` if Hugging Face fails.

**How it works:** it doesn't use embeddings or a vector database, because the three files total only about 6K tokens. The CSVs are parsed into services and voyages (`parseWeeklyCsv.ts`), and the model (`HF_MODEL` on Hugging Face Inference Providers) answers by calling two tools that run in code:

- `get_voyages`: one service's voyages and their exact count, in the newest file or a chosen one.
- `compare_files`: voyages added, removed and rescheduled between two files (`scheduleDiff.ts`).

Counts and differences therefore come from the data, not from the model. Comparisons only cover the dates both files include. Sailings that appear only because the newer file looks further ahead are reported separately as `furtherAhead`, not as changes. Each question makes 1–3 model calls, a fraction of a cent with the default model.

### Calling it from the frontend

The success response is a file, not JSON, so read it as a blob. To get the cron's latest CSV:

```ts
const res = await fetch(`${API_URL}/api/v1/schedules/one/weekly/latest`)
if (!res.ok) throw new Error((await res.json()).error)

const blob = await res.blob()
const filename = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] ?? 'schedule.csv'
const link = document.createElement('a')
link.href = URL.createObjectURL(blob)
link.download = filename
link.click()
URL.revokeObjectURL(link.href)
```

For a fresh scrape with your own options, make the same call as `POST /schedules/one/weekly` with a JSON body, e.g. `{ "next": 4, "services_routes": "all" }`.

CORS allows any origin, and `Content-Disposition` is exposed, so the frontend can read the filename.

### Trying requests

`requests.http` has a ready-made request for every endpoint. Open it in VS Code with the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension and click **Send Request**.

## Deploying to Vercel

The repo deploys to Vercel as-is: pushing to `main` builds production.

- **`vercel.json`** turns off Vercel's Express auto-detection, runs `npm run build`, and sends every request to `api/index.js`, which serves the compiled app from `dist/`. Functions may run up to 300 seconds.
- **Chrome:** Vercel functions can't run the Chrome that Puppeteer downloads, so when `VERCEL` is set, `launchBrowser()` starts the serverless build from `@sparticuz/chromium` instead. `vercel.json` includes its binaries in the function.
- **Cron:** `vercel.json` calls `GET /api/v1/schedules/one/weekly/cron` every Saturday at 01:00 UTC (`0 1 * * 6`), and `GET /api/v1/schedules/one/healthCheck` every 3 days at 02:00 UTC (`0 2 */3 * *`: the 1st, 4th, 7th… of each month). Cron times are UTC, so 08:00 in Vietnam is 01:00. On the Hobby plan a cron runs at most once a day, at some point within the chosen hour.
- **Blob storage:** in the Vercel dashboard, open **Storage → Create → Blob**, choose **Private** access, and connect the store to this project. That adds `BLOB_READ_WRITE_TOKEN`. Also add `CRON_SECRET` and `HF_TOKEN` (and `HF_MODEL` to change the chat model) under **Settings → Environment Variables**, then redeploy.
- **`public/`** is intentionally empty. It stops Vercel from serving repository files as static files.

## How the ONE download works

For each service, `src/modules/schedules/one.scraper.ts`:

1. Opens ONE's point-to-point schedule page with the route in the URL.
2. Clicks "Essential Only" on the cookie banner.
3. Selects the service in the **Service Lane** dropdown.
4. Selects **Show all items**, so the export isn't limited to the first page.
5. Clicks **Download**, then **xlsx**, and reads the file.

The xlsx is then converted to the weekly CSV (`scheduleXlsx.ts` and `weeklySchedule.ts`).

While a weekly request runs, the server log shows each service as it starts and finishes (green for success, yellow for N/A, red for failure), then a table of sailings per service.

The scraper depends on ONE's page structure (element IDs such as `#schedule-service` and `data-cy` attributes). If ONE changes its site, these selectors may need updating.

### Services and locations

- **Default services:** `oneServices.ts` lists them. Each is searched on the first origin and first destination of its route, e.g. `VSE (VUT/HPH - LAX/LGB)` is searched as VUT → LAX.
- **Locations:** `oneLocations.ts` maps UN/LOCODEs to the names ONE uses. To add one, look up its exact name with:

  ```
  https://ecomm.one-line.com/api/v1/schedule/point-to-point/search?pointName=<NAME>
  ```

- **Port aliases:** ONE has no "VUT" (Vung Tau), so VUT is searched as Cai Mep (`VNCMP`). HAF and HAL are Halifax (`CAHAL`).

## Project structure

```
src/
  server.ts                  Starts the HTTP server, shuts down cleanly
  app.ts                     Express app: security headers, CORS, JSON, logging, routes, errors
  routes.ts                  Mounts every module's router under /api/v1
  config/env.ts              Typed, validated environment
  middleware/                notFound, errorHandler
  lib/HttpError.ts           Throw new HttpError(404, '...') from any route
  modules/
    health/                  GET /health
    chat/
      chat.controller.ts     POST /chat: validation, loads and parses the last 3 CSVs
      scheduleBot.ts         Hugging Face chat loop with tool calls
      scheduleTools.ts       get_voyages and compare_files, run in code
    schedules/
      schedules.routes.ts    Routes
      schedules.controller.ts  Request validation, weekly orchestration, cron
      scheduleStore.ts       Saves and reads the cron's CSV in Vercel Blob
      one.scraper.ts         Puppeteer flow on ONE's site
      oneServices.ts         Default services and routes
      oneLocations.ts        Location codes → ONE names
      scheduleXlsx.ts        Reads sailings from ONE's xlsx
      weeklySchedule.ts      Builds the weekly CSV
      parseWeeklyCsv.ts      Reads a weekly CSV back into services and voyages
      scheduleDiff.ts        Compares two weekly schedules
tests/                       Endpoint tests against createApp(), with the scraper, Blob and model mocked
requests.http                Example requests for REST Client
```

### Adding a feature

1. Create `src/modules/<feature>/` with `<feature>.routes.ts` and `<feature>.controller.ts`.
2. Mount the router in `src/routes.ts`: `apiRouter.use('/<feature>', <feature>Router)`.
3. Validate input with Zod (`schema.parse(req.body)`). Invalid input becomes a 400 automatically.
