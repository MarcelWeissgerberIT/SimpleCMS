/**
 * Local days and months for the Regler (pure: Node specs load it). A day is 'yyyy-MM-dd' in the browser's zone, a month
 * 'yyyy-MM'; the ledger keys its entries by the same day.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day of a time, 'yyyy-MM-dd'. */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The month of a day, 'yyyy-MM'. */
export const monthOf = (day: string): string => day.slice(0, 7)

/** The closed days of a day's month before it, oldest first ('2026-10-03' → 10-01, 10-02). */
export function closedDaysBefore(day: string): string[] {
  const n = Number(day.slice(8, 10))
  const month = monthOf(day)
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => `${month}-${pad(i + 1)}`)
}

/** The next local midnight after a time (ms). */
export function nextMidnight(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
