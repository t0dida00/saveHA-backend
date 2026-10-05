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

### Calling it from the frontend

The success response is a file, not JSON, so read it as a blob:

```ts
const res = await fetch(`${API_URL}/api/v1/schedules/one/weekly`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ next: 8, services_routes: 'all' }),
})
if (!res.ok) throw new Error((await res.json()).error)

const blob = await res.blob()
const filename = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] ?? 'schedule.csv'
const link = document.createElement('a')
link.href = URL.createObjectURL(blob)
link.download = filename
link.click()
URL.revokeObjectURL(link.href)
```

CORS allows any origin, and `Content-Disposition` is exposed, so the frontend can read the filename.

### Trying requests

`requests.http` has a ready-made request for every endpoint. Open it in VS Code with the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension and click **Send Request**.

## Deploying to Vercel

The repo deploys to Vercel as-is: pushing to `main` builds production.

- **`vercel.json`** turns off Vercel's Express auto-detection, runs `npm run build`, and sends every request to `api/index.js`, which serves the compiled app from `dist/`. Functions may run up to 300 seconds.
- **Chrome:** Vercel functions can't run the Chrome that Puppeteer downloads, so when `VERCEL` is set, `launchBrowser()` starts the serverless build from `@sparticuz/chromium` instead. `vercel.json` includes its binaries in the function.
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
    schedules/
      schedules.routes.ts    Routes
      schedules.controller.ts  Request validation, weekly orchestration, saving files
      one.scraper.ts         Puppeteer flow on ONE's site
      oneServices.ts         Default services and routes
      oneLocations.ts        Location codes → ONE names
      scheduleXlsx.ts        Reads sailings from ONE's xlsx
      weeklySchedule.ts      Builds the weekly CSV
tests/                       Endpoint tests against createApp(), with the scraper mocked
requests.http                Example requests for REST Client
```

### Adding a feature

1. Create `src/modules/<feature>/` with `<feature>.routes.ts` and `<feature>.controller.ts`.
2. Mount the router in `src/routes.ts`: `apiRouter.use('/<feature>', <feature>Router)`.
3. Validate input with Zod (`schema.parse(req.body)`). Invalid input becomes a 400 automatically.
