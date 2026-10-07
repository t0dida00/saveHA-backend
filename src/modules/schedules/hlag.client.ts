import { env } from '../../config/env.ts'
import { HttpError } from '../../lib/HttpError.ts'

// The parts of the DCSA Commercial Schedules v1 response we read
// (https://github.com/dcsaorg/DCSA-OpenAPI/blob/master/cs/v1/CS_v1.0.4.yaml)
export interface DcsaPointToPoint {
  placeOfReceipt: DcsaPlace
  placeOfDelivery: DcsaPlace
  transitTime?: number
  legs: DcsaLeg[]
}

export interface DcsaLeg {
  sequenceNumber?: number
  transport: {
    modeOfTransport: string
    vessel?: { name?: string; vesselIMONumber?: string }
    servicePartners?: {
      carrierCode?: string
      carrierServiceCode?: string
      carrierServiceName?: string
      carrierExportVoyageNumber?: string
    }[]
    universalExportVoyageReference?: string
  }
  departure: DcsaPlace
  arrival: DcsaPlace
}

interface DcsaPlace {
  location: { UNLocationCode?: string; locationName?: string }
  /** e.g. 2026-10-08T22:00:00+07:00, local time at the place */
  dateTime: string
}

export interface HlagRouteSearch {
  origin: string
  destination: string
  /** First and last departure date to include, YYYY-MM-DD */
  fromDate: string
  toDate: string
}

// A page is plenty for one port pair, but follow the cursor in case Hapag-Lloyd splits it
const MAX_PAGES = 10

export class HlagNotConfiguredError extends HttpError {
  constructor() {
    super(503, 'Hapag-Lloyd API is not configured: set HLAG_API_URL, HLAG_CLIENT_ID and HLAG_CLIENT_SECRET')
  }
}

/** Point-to-point routes from Hapag-Lloyd's official Commercial Schedules API, every page */
export async function fetchHlagRoutes(search: HlagRouteSearch): Promise<DcsaPointToPoint[]> {
  if (!env.HLAG_API_URL || !env.HLAG_CLIENT_ID || !env.HLAG_CLIENT_SECRET) throw new HlagNotConfiguredError()

  const routes: DcsaPointToPoint[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(env.HLAG_API_URL)
    if (cursor) {
      // The cursor stands for the whole query, so it replaces the other parameters
      url.searchParams.set('cursor', cursor)
    } else {
      url.searchParams.set('placeOfReceipt', search.origin)
      url.searchParams.set('placeOfDelivery', search.destination)
      url.searchParams.set('departureStartDate', search.fromDate)
      url.searchParams.set('departureEndDate', search.toDate)
    }

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-IBM-Client-Id': env.HLAG_CLIENT_ID,
        'X-IBM-Client-Secret': env.HLAG_CLIENT_SECRET,
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`Hapag-Lloyd API ${response.status}:`, body.slice(0, 500))
      // 401/403 means our credentials, not the caller's request: report it as a gateway problem
      throw new HttpError(502, `Hapag-Lloyd API returned ${response.status} ${response.statusText}`)
    }

    routes.push(...((await response.json()) as DcsaPointToPoint[]))
    cursor = response.headers.get('Next-Page-Cursor')
    if (!cursor) break
  }
  return routes
}
