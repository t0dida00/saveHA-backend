import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer'
import { HttpError } from '../../lib/HttpError.ts'

const SCHEDULE_URL = 'https://www.one-line.com/one-ecom/schedule/point-to-point-schedule'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const DOWNLOAD_TIMEOUT_MS = 60_000

export interface OneP2pScheduleQuery {
  /** UN/LOCODE, e.g. VNHPH */
  origin: string
  /** Name exactly as ONE lists it, e.g. "HAI PHONG, VIETNAM" */
  originName: string
  /** UN/LOCODE, e.g. USLAX */
  destination: string
  destinationName: string
  /** Service lane code, e.g. PS7 */
  service: string
  /** First departure date, YYYY-MM-DD */
  fromDate: string
  weeks: number
}

/** ONE doesn't list the service on this route, as opposed to the page failing to load */
export class ServiceNotOnRouteError extends HttpError {
  constructor(service: string, available: string[]) {
    super(404, `Service ${service} not found on this route. Available: ${available.join(', ') || 'none'}`)
    this.name = 'ServiceNotOnRouteError'
  }
}

export interface DownloadedFile {
  filename: string
  data: Buffer
}

export function buildScheduleUrl(query: OneP2pScheduleQuery): string {
  const [year, month] = query.fromDate.split('-')
  const params = new URLSearchParams({
    oriLocNmParam: query.originName,
    destLocNmParam: query.destinationName,
    oriLocCdParam: query.origin,
    destLocCdParam: query.destination,
    oriTermCdPara: 'Y',
    desTermCdPara: 'Y',
    frmDtParam: query.fromDate,
    nextWeekValue: String(query.weeks * 7),
    cargoNature: 'GP',
    isEnabledCO2: 'false',
    year: year!,
    month: String(Number(month)),
    searchType: 'List',
    isPolPodOn: 'false',
  })
  return `${SCHEDULE_URL}?${params}`
}

/**
 * Opens ONE's point-to-point schedule page, filters it to one service lane and
 * downloads the schedule as the site's own xlsx export.
 */
export async function downloadOneP2pSchedule(query: OneP2pScheduleQuery): Promise<DownloadedFile> {
  const downloadDir = await mkdtemp(path.join(tmpdir(), 'one-schedule-'))
  const browser = await puppeteer.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.setUserAgent(USER_AGENT)

    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true })

    let filename = ''
    const downloaded = new Promise<void>((resolve, reject) => {
      cdp.on('Browser.downloadWillBegin', (event) => {
        filename = event.suggestedFilename
      })
      cdp.on('Browser.downloadProgress', (event) => {
        if (event.state === 'completed') resolve()
        if (event.state === 'canceled') reject(new Error('ONE schedule download was canceled'))
      })
    })

    await page.goto(buildScheduleUrl(query), { waitUntil: 'networkidle2', timeout: 90_000 })
    await dismissCookieBanner(page)
    // Without results the page falls back to an empty search form
    await page
      .waitForSelector('[data-cy="new-schedule-download-button"]', { timeout: 30_000 })
      .catch(() => {
        throw new HttpError(404, 'ONE returned no schedule for this route')
      })
    await selectService(page, query.service)
    await showAllItems(page)

    await page.click('[data-cy="new-schedule-download-button"]')
    await page.waitForSelector('[data-button-type="common-modal-download-btn-xlsx"]', { timeout: 15_000 })
    await page.click('[data-button-type="common-modal-download-btn-xlsx"]')

    await withTimeout(downloaded, DOWNLOAD_TIMEOUT_MS, 'Timed out waiting for the ONE schedule download')
    return { filename, data: await readFile(path.join(downloadDir, filename)) }
  } finally {
    await browser.close()
    await rm(downloadDir, { recursive: true, force: true })
  }
}

async function dismissCookieBanner(page: Page) {
  const reject = await page.$('button[data-cky-tag="reject-button"]')
  if (reject) await reject.click().catch(() => {})
}

// "Show all items" in the page-size dropdown; its value is Number.MAX_SAFE_INTEGER
const SHOW_ALL_ITEMS = '9007199254740991'

async function selectService(page: Page, service: string) {
  const trigger = '#schedule-service'
  const listbox = await openDropdown(page, trigger, 'service lane')

  const option = `${listbox} [role="option"][value="${service}"]`
  if (!(await page.$(option))) {
    const available = await page.$$eval(`${listbox} [role="option"]`, (options) =>
      options.map((o) => o.getAttribute('value')).filter((v) => v && v !== 'All'),
    )
    throw new ServiceNotOnRouteError(service, available)
  }

  await page.click(option)
  await page.waitForSelector(`${trigger}[data-schedule-p2p-service-code="${service}"]`, { timeout: 15_000 })
}

/** Lists every sailing on one page so the export isn't limited to the first 10 */
async function showAllItems(page: Page) {
  const trigger = '#new-schedule-routes-per-page'
  const listbox = await openDropdown(page, trigger, 'items per page')
  await page.click(`${listbox} [role="option"][value="${SHOW_ALL_ITEMS}"]`)
  await page.waitForSelector(`${trigger} ::-p-text(Show all items)`, { timeout: 15_000 })
}

/** Opens one of the page's comboboxes and returns the selector of its option list */
async function openDropdown(page: Page, trigger: string, label: string): Promise<string> {
  const listbox = `${trigger}--floating-list`
  await page.waitForSelector(trigger)

  // The comboboxes ignore clicks until the page finishes hydrating; ArrowDown opens them more reliably
  for (let attempt = 0; attempt < 10 && !(await page.$(listbox)); attempt++) {
    if (attempt % 2 === 0) await page.click(trigger).catch(() => {})
    else {
      await page.focus(trigger)
      await page.keyboard.press('ArrowDown')
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }

  if (!(await page.$(listbox))) throw new Error(`Could not open the ${label} dropdown on the ONE schedule page`)
  return listbox
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
