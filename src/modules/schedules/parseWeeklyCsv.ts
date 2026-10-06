const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export interface Voyage {
  /** e.g. WAN HAI A03 */
  vessel: string
  /** e.g. E018 */
  voyage: string
  /** Departure from the origin, YYYY-MM-DD */
  departure: string
  /** ISO week of the departure, e.g. W41/2026 */
  week: string
}

export interface ServiceSchedule {
  service: string
  /** e.g. HPH/VUT - LAX/LGB/OAK */
  route: string
  /** N/A: ONE doesn't run the service on the route; ERROR: the download failed */
  status: 'ok' | 'N/A' | 'ERROR'
  voyages: Voyage[]
}

export interface WeeklySchedule {
  /** e.g. ONE-06102026.csv */
  file: string
  /** Date the schedule was scraped from, YYYY-MM-DD */
  date: string
  /** Every week row in the file, including weeks with no sailings, e.g. { week: 'W41/2026', dates: '05/10-11/10' } */
  weeks: { week: string; dates: string }[]
  services: ServiceSchedule[]
}

/** Reads a CSV written by weeklyScheduleCsv back into services and voyages */
export function parseWeeklyCsv(file: string, csv: string): WeeklySchedule {
  const [header = [], ...rows] = readCsv(csv.replace(/^﻿/, ''))
  const weekRows = rows.filter((row) => /^W\d{2}\/\d{4}/.test(row[0] ?? ''))

  const services = header.slice(1).map((label, i): ServiceSchedule => {
    // "PS7\n(HPH/VUT - LAX/LGB/OAK)"
    const [service = label, route = ''] = label.split('\n')
    const cells = weekRows.map((row) => ({ week: row[0]!, cell: row[i + 1] ?? '' }))
    const placeholder = cells.find(({ cell }) => cell === 'N/A' || cell === 'ERROR')?.cell
    return {
      service: service.trim(),
      route: route.replace(/^\(|\)$/g, ''),
      status: placeholder === 'N/A' || placeholder === 'ERROR' ? placeholder : 'ok',
      voyages: placeholder ? [] : cells.flatMap(({ week, cell }) => parseCell(week, cell)),
    }
  })

  const weeks = weekRows.map((row) => {
    const [week = '', dates = ''] = row[0]!.split('\n')
    return { week, dates }
  })
  return { file, date: fileDate(file), weeks, services }
}

/** "WAN HAI A03 E018/ OCT 08\nYM WIND 036E/ OCT 10" in week "W41/2026\n05/10-11/10" */
function parseCell(weekLabel: string, cell: string): Voyage[] {
  if (cell === 'OMIT' || cell === '') return []
  const [week = '', range = ''] = weekLabel.split('\n')
  return cell.split('\n').flatMap((line) => {
    const match = /^(.+?)\s+(\S+)\/\s*([A-Z]{3}) (\d{2})$/.exec(line.trim())
    if (!match) return []
    const [, vessel, voyage, month, day] = match
    return [{ vessel: vessel!, voyage: voyage!, departure: departureDate(week, range, month!, day!), week }]
  })
}

/**
 * The cell only has "OCT 08", so the year comes from the week label. A week can span New
 * Year: W01/2027 runs 28/12-03/01, and its Monday falls in December 2026.
 */
function departureDate(week: string, range: string, month: string, day: string): string {
  const isoYear = Number(week.split('/')[1])
  const mondayMonth = Number(range.slice(3, 5))
  const mondayYear = week.startsWith('W01') && mondayMonth === 12 ? isoYear - 1 : isoYear
  const departureMonth = MONTHS.indexOf(month) + 1
  // A month earlier than Monday's means the week crossed into January
  const year = departureMonth < mondayMonth ? mondayYear + 1 : mondayYear
  return `${year}-${String(departureMonth).padStart(2, '0')}-${day}`
}

/** "ONE-06102026.csv" -> "2026-10-06" */
function fileDate(file: string): string {
  const match = /(\d{2})(\d{2})(\d{4})/.exec(file)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

/** RFC 4180: quoted fields may hold commas, newlines and doubled quotes */
function readCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}
