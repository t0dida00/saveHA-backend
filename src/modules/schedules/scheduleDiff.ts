import type { ServiceSchedule, Voyage, WeeklySchedule } from './parseWeeklyCsv.ts'

export interface ServiceDiff {
  service: string
  /** Set when the service went e.g. from ok to N/A */
  statusChanged?: { from: ServiceSchedule['status']; to: ServiceSchedule['status'] }
  /** Sailings only in the newer file */
  added: Voyage[]
  /** Sailings only in the older file */
  removed: Voyage[]
  /** Same vessel and voyage, different departure date */
  rescheduled: { vessel: string; voyage: string; from: string; to: string }[]
}

export interface ScheduleDiff {
  older: string
  newer: string
  /**
   * Departure dates both files cover. Each file is a window from its scrape date, so outside
   * this range a sailing would look added or removed just because time moved on.
   */
  window: { from: string; to: string }
  /** Services with at least one change; unchanged ones are left out */
  services: ServiceDiff[]
  unchanged: string[]
  /** Sailings after the window that only the newer file shows: it looks further ahead, nothing changed */
  furtherAhead: { service: string; voyages: Voyage[] }[]
}

/** Compares two weekly schedules service by service, matching sailings on vessel + voyage */
export function diffSchedules(older: WeeklySchedule, newer: WeeklySchedule, service?: string): ScheduleDiff {
  const window = { from: newer.date, to: [lastDeparture(older), lastDeparture(newer)].sort()[0] ?? newer.date }
  const inWindow = (v: Voyage) => v.departure >= window.from && v.departure <= window.to
  const names = [...new Set([...older.services, ...newer.services].map((s) => s.service))].filter(
    (name) => !service || name === service,
  )
  const services: ServiceDiff[] = []
  const unchanged: string[] = []
  const furtherAhead: ScheduleDiff['furtherAhead'] = []

  for (const name of names) {
    const before = older.services.find((s) => s.service === name)
    const after = newer.services.find((s) => s.service === name)
    const beforeVoyages = new Map((before?.voyages ?? []).filter(inWindow).map((v) => [key(v), v]))
    const afterVoyages = new Map((after?.voyages ?? []).filter(inWindow).map((v) => [key(v), v]))

    const diff: ServiceDiff = {
      service: name,
      added: [...afterVoyages].filter(([k]) => !beforeVoyages.has(k)).map(([, v]) => v),
      removed: [...beforeVoyages].filter(([k]) => !afterVoyages.has(k)).map(([, v]) => v),
      rescheduled: [...afterVoyages].flatMap(([k, v]) => {
        const was = beforeVoyages.get(k)
        return was && was.departure !== v.departure
          ? [{ vessel: v.vessel, voyage: v.voyage, from: was.departure, to: v.departure }]
          : []
      }),
    }
    const beforeStatus = before?.status ?? 'N/A'
    const afterStatus = after?.status ?? 'N/A'
    if (beforeStatus !== afterStatus) diff.statusChanged = { from: beforeStatus, to: afterStatus }

    const later = (after?.voyages ?? []).filter((v) => v.departure > window.to)
    if (later.length) furtherAhead.push({ service: name, voyages: later })

    const changed = diff.statusChanged || diff.added.length || diff.removed.length || diff.rescheduled.length
    if (changed) services.push(diff)
    else unchanged.push(name)
  }

  return { older: older.file, newer: newer.file, window, services, unchanged, furtherAhead }
}

function lastDeparture(schedule: WeeklySchedule): string | undefined {
  return schedule.services.flatMap((s) => s.voyages.map((v) => v.departure)).sort().at(-1)
}

function key(voyage: Voyage): string {
  return `${voyage.vessel} ${voyage.voyage}`
}
