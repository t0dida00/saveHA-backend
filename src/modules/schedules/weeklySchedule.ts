import type { Sailing } from './scheduleXlsx.ts'

const DAY_MS = 86_400_000
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export interface ScheduleColumn {
  /** Header cell, e.g. "PS7\n(HPH - LAX)" */
  label: string
  /** ONE search page for this column, shown in the QueryString row */
  url: string
  /** Text to fill every week with instead of sailings, e.g. when ONE doesn't run the service */
  placeholder?: string
  sailings: Sailing[]
}

/**
 * Lays sailings out one row per ISO week and one column per service, from the
 * week of fromDate to the week of the last sailing in any column:
 *
 *   ONE                    | PS7 (HPH - LAX)            | VSE (VUT - LAX)
 *   QueryString            | https://www.one-line.com/… | https://www.one-line.com/…
 *   W41/2026 05/10-11/10   | WAN HAI A03 E018/ OCT 08   | OMIT
 *
 * Weeks with no sailing read OMIT; weeks with several list each on its own line.
 */
export function weeklyScheduleCsv(columns: ScheduleColumn[], fromDate: string): string {
  const rows = [
    ['ONE', ...columns.map((column) => column.label)],
    ['QueryString', ...columns.map((column) => column.url)],
  ]

  const departures = columns.flatMap((column) => column.sailings.map((s) => s.departure)).sort()
  const last = departures.at(-1)
  if (last) {
    const lastMonday = mondayOf(last)
    for (let monday = mondayOf(fromDate); monday <= lastMonday; monday += 7 * DAY_MS) {
      rows.push([weekLabel(monday), ...columns.map((column) => weekCell(column, monday))])
    }
  }

  return '﻿' + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

function weekCell(column: ScheduleColumn, monday: number): string {
  if (column.placeholder) return column.placeholder
  return (
    column.sailings
      .filter((s) => mondayOf(s.departure) === monday)
      .sort((a, b) => a.departure.localeCompare(b.departure))
      .map((s) => `${s.vessel}/ ${monthDay(s.departure)}`)
      .join('\n') || 'OMIT'
  )
}

/** Monday 00:00 UTC of the date's ISO week, as epoch ms */
function mondayOf(date: string): number {
  const day = Date.parse(`${date}T00:00:00Z`)
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS
}

/** "W41/2026\n05/10-11/10" */
function weekLabel(monday: number): string {
  // The ISO week belongs to the year its Thursday falls in
  const thursday = new Date(monday + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1
  return `W${String(week).padStart(2, '0')}/${year}\n${dayMonth(monday)}-${dayMonth(monday + 6 * DAY_MS)}`
}

function dayMonth(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "2026-10-08" -> "OCT 08" */
function monthDay(date: string): string {
  const [, month, day] = date.split('-')
  return `${MONTHS[Number(month) - 1]} ${day}`
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
