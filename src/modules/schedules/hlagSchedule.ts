import type { DcsaLeg, DcsaPointToPoint } from './hlag.client.ts'
import type { ScheduleColumn } from './weeklySchedule.ts'

/**
 * Turns Hapag-Lloyd routes into weekly CSV columns, one per service like ONE's. A route's
 * sailing is its first vessel leg, the ship leaving the origin port; its service names the
 * column. Several routes often share that ship (different onward connections), so each
 * vessel + voyage + date appears once.
 */
export function hlagColumns(routes: DcsaPointToPoint[], origin: string, destination: string, url: string): ScheduleColumn[] {
  const route = `${origin.slice(2)} - ${destination.slice(2)}`
  const byService = new Map<string, Map<string, { departure: string; vessel: string }>>()

  for (const point of routes) {
    const leg = firstVesselLeg(point)
    if (!leg) continue
    const partner = leg.transport.servicePartners?.[0]
    const service = partner?.carrierServiceCode || partner?.carrierServiceName || 'UNKNOWN'
    const voyage = partner?.carrierExportVoyageNumber || leg.transport.universalExportVoyageReference || ''
    const vessel = [leg.transport.vessel?.name?.trim().toUpperCase() || 'TBN', voyage].filter(Boolean).join(' ')
    // The local date at the port; the offset in dateTime is the port's own
    const departure = leg.departure.dateTime.slice(0, 10)

    const sailings = byService.get(service) ?? new Map()
    sailings.set(`${vessel} ${departure}`, { departure, vessel })
    byService.set(service, sailings)
  }

  return [...byService]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, sailings]) => ({ label: `${service}\n(${route})`, url, sailings: [...sailings.values()] }))
}

function firstVesselLeg(point: DcsaPointToPoint): DcsaLeg | undefined {
  return [...point.legs]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .find((leg) => leg.transport.modeOfTransport === 'VESSEL')
}
