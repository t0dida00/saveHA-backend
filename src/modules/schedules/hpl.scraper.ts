import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { HttpError } from '../../lib/HttpError.ts'

const SCHEDULE_URL = 'https://www.hapag-lloyd.com/solutions/schedule/#/'
// Kept between runs so the security check's clearance cookie lasts and the check rarely shows again
const PROFILE_DIR = path.join(tmpdir(), 'hpl-chrome-profile')
// Time for a person to pass the security check in the Chrome window
const SECURITY_CHECK_TIMEOUT_MS = 3 * 60_000
const RESULTS_TIMEOUT_MS = 45_000
const DAY_MS = 86_400_000

const START_INPUT = 'input[data-testid="startLocationComponent"]'
const END_INPUT = 'input[data-testid="endLocationComponent"]'
const CARD = '.hal-schedule'

export interface HplScheduleQuery {
  /** UN/LOCODE, e.g. VNVUT */
  from: string
  /** UN/LOCODE, e.g. USNYC */
  to: string
  /** First departure date, YYYY-MM-DD */
  fromDate: string
  weeks: number
}

/** One result card on Hapag-Lloyd's schedule page: its first ship leaving the start location */
export interface HplSailing {
  /** e.g. AA7; empty when the card shows no service */
  service: string
  /** e.g. WAN HAI A15 */
  vessel: string
  /** e.g. E010 */
  voyage: string
  /** Departure from the start location, YYYY-MM-DD */
  departure: string
}

let sharedBrowser: Promise<Browser> | undefined
let queue: Promise<unknown> = Promise.resolve()

/**
 * Hapag-Lloyd's site sits behind a security check that a person has to pass, so this runs a
 * visible Chrome on the machine running the API (local only), with a profile kept between runs.
 * One Chrome is shared and searches run one at a time, so the check never shows twice at once.
 */
export function scrapeHplSchedule(query: HplScheduleQuery): Promise<HplSailing[]> {
  if (process.env.VERCEL) {
    throw new HttpError(501, 'Hapag-Lloyd needs the local backend: its site requires a person to pass a security check')
  }
  const run = queue.then(() => scrape(query))
  queue = run.catch(() => {})
  return run
}

function hplBrowser(): Promise<Browser> {
  sharedBrowser ??= puppeteer
    .launch({ headless: false, defaultViewport: null, userDataDir: PROFILE_DIR, args: ['--window-size=1400,950'] })
    .then((browser) => {
      // Closing the window ends this Chrome; the next search opens a new one
      browser.on('disconnected', () => (sharedBrowser = undefined))
      return browser
    })
    .catch((error: unknown) => {
      sharedBrowser = undefined
      throw error
    })
  return sharedBrowser
}

async function scrape(query: HplScheduleQuery): Promise<HplSailing[]> {
  const browser = await hplBrowser()
  const page = await browser.newPage()
  try {
    await page.goto(SCHEDULE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.bringToFront()
    await waitForSearchForm(page)
    await dismissCookieBanner(page)

    // The form fills in the location names the results URL needs; later windows only change its date
    await pickLocation(page, START_INPUT, query.from)
    await pickLocation(page, END_INPUT, query.to)
    await page.click('button[type="submit"]')
    await page.waitForFunction("location.hash.includes('departureDate=')", { timeout: RESULTS_TIMEOUT_MS })
    const resultsUrl = page.url()

    // Each search lists about five weeks from its date; search again from the day after the last
    // sailing until the requested weeks are covered or nothing new comes back
    const lastDay = isoDate(Date.parse(`${query.fromDate}T00:00:00Z`) + (query.weeks * 7 - 1) * DAY_MS)
    const sailings = new Map<string, HplSailing>()
    for (let from = query.fromDate; from <= lastDay; ) {
      await showResultsFrom(page, resultsUrl, from)
      for (const sailing of await readAllCards(page)) {
        if (sailing.departure >= query.fromDate && sailing.departure <= lastDay) {
          sailings.set(`${sailing.service} ${sailing.vessel} ${sailing.voyage} ${sailing.departure}`, sailing)
        }
      }
      const latest = [...sailings.values()].map((s) => s.departure).sort().at(-1)
      const next = latest ? isoDate(Date.parse(`${latest}T00:00:00Z`) + DAY_MS) : undefined
      if (!next || next <= from) break
      from = next
    }
    return [...sailings.values()]
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Waits for the search form while a person passes the security check. The check reloads the page
 * when it's passed, which breaks a plain waitForSelector, so this polls and shrugs off those reloads.
 */
async function waitForSearchForm(page: Page) {
  const deadline = Date.now() + SECURITY_CHECK_TIMEOUT_MS
  while (Date.now() < deadline) {
    const input = await page.$(START_INPUT).catch(() => null)
    if (input && (await input.isVisible().catch(() => false))) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new HttpError(504, 'Hapag-Lloyd security check was not passed in time')
}

async function dismissCookieBanner(page: Page) {
  const reject = await page.$('#onetrust-reject-all-handler')
  if (reject && (await reject.isVisible())) await reject.click().catch(() => {})
}

/** Types a UN/LOCODE and picks the suggestion that ends in it, e.g. "VUNG TAU (VNVUT)" */
async function pickLocation(page: Page, input: string, code: string) {
  await page.click(input, { count: 3 })
  await page.type(input, code, { delay: 60 })
  const option = `::-p-xpath(//*[@role="option"][contains(., "(${code})")])`
  await page.waitForSelector(option, { timeout: 20_000 }).catch(() => {
    throw new HttpError(400, `Hapag-Lloyd doesn't know the location ${code}`)
  })
  await page.click(option)
  // Run in the page, which has the DOM types this project doesn't load
  await page.waitForFunction(`(document.querySelector(${JSON.stringify(input)})?.value ?? '').includes(${JSON.stringify(code)})`, {
    timeout: 10_000,
  })
}

/**
 * Opens the results for one departure date and waits for fresh cards. Cards already on the page
 * are marked first, so the wait can't be fooled by the previous window's list.
 */
async function showResultsFrom(page: Page, resultsUrl: string, date: string) {
  await page.$$eval(CARD, (cards) => cards.forEach((card) => card.setAttribute('data-stale', '')))
  const url = new URL(resultsUrl)
  url.hash = url.hash.replace(/departureDate=[^&]*/, `departureDate=${date}`)
  if (page.url() !== url.toString()) await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  // No new cards in time means this window has no sailings
  await page.waitForSelector(`${CARD}:not([data-stale])`, { timeout: RESULTS_TIMEOUT_MS }).catch(() => {})
}

/** Reads the cards, clicking "Next" while the page offers one */
async function readAllCards(page: Page): Promise<HplSailing[]> {
  const sailings = await readCards(page)
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const next = await page.$('::-p-xpath(//button[not(@disabled)][normalize-space(.)="Next"])')
    if (!next || !(await next.isVisible())) break
    await page.$$eval(CARD, (cards) => cards.forEach((card) => card.setAttribute('data-stale', '')))
    await next.click()
    await page.waitForSelector(`${CARD}:not([data-stale])`, { timeout: RESULTS_TIMEOUT_MS }).catch(() => {})
    sailings.push(...(await readCards(page)))
  }
  return sailings
}

function readCards(page: Page): Promise<HplSailing[]> {
  return page.$$eval(`${CARD}:not([data-stale])`, (cards) =>
    cards.flatMap((card) => {
      const text = (selector: string, root = card) => root.querySelector(selector)?.textContent?.trim() ?? ''
      // The first voyage is the ship leaving the start location; later ones are transhipments
      const voyage = card.querySelector('.hal-schedule-voyage')
      const departure = text('.hal-schedule-location--start .hal-schedule-location__date')
      if (!voyage || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) return []
      return [
        {
          // Gemini Cooperation services (e.g. US4) wear a different badge
          service: text('.q-badge--service, .q-badge--gemini', voyage),
          vessel: text('.q-badge--vessel', voyage).toUpperCase(),
          voyage: text('.q-badge--voyage', voyage).replace(/^voyage no\.?:?\s*/i, ''),
          departure,
        },
      ]
    }),
  )
}

function isoDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}
