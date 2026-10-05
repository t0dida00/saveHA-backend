import ExcelJS from 'exceljs'

export interface Sailing {
  /** Departure from the origin, YYYY-MM-DD */
  departure: string
  /** e.g. WAN HAI A03 E018 */
  vessel: string
}

/**
 * Reads the sailings from ONE's schedule export. The sheet opens with link rows
 * and a two-row merged header, so data starts after the "Origin" header rows.
 */
export async function readSailings(xlsx: Buffer): Promise<Sailing[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Schedule workbook has no sheets')

  const rows: string[][] = []
  sheet.eachRow((row) => {
    rows.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellText))
  })

  const header = rows.find((row) => row[0] === 'Origin')
  const originCol = header?.indexOf('Origin') ?? -1
  const vesselCol = header?.indexOf('Vessel/Voyage') ?? -1
  if (originCol === -1 || vesselCol === -1) throw new Error('Schedule workbook is missing the Origin or Vessel/Voyage column')

  return rows.flatMap((row) => {
    // "HAI PHONG 2026-10-08 (Thu)" -> 2026-10-08; header and link rows have no date
    const departure = row[originCol]?.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    const vessel = row[vesselCol]
    return departure && vessel ? [{ departure, vessel }] : []
  })
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text)
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('result' in value) return String(value.result ?? '')
  }
  return String(value).replace(/\s*\n\s*/g, ' ').trim()
}
