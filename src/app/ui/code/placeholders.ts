/**
 * Placeholders a person still has to fill in, e.g. "[HOW TO LIST THE ITEMS]" in an agent's job. The pattern is
 * the caller's (CodeArea `placeholders` prop); PLACEHOLDER_PATTERN is the default: square brackets around at
 * least three capitals, digits, spaces or / ' " „ “ ” ‚ ‘ ’ _ . - — with two capitals in a row, so "[x]", "[ ]" and
 * "[1, 2]" never count.
 */

export const PLACEHOLDER_PATTERN = /\[(?=[^\]\n]*[A-ZÄÖÜ]{2})[A-ZÄÖÜ0-9 /'"„“”‚‘’_.-]{3,}\]/g

export interface PlaceholderHit {
  start: number
  end: number
  text: string
}

/** The pattern with the global flag (a caller's pattern may lack it). */
function global(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
}

/** Every placeholder in the text, in order (empty matches are skipped). */
export function findPlaceholders(text: string, pattern: RegExp = PLACEHOLDER_PATTERN): PlaceholderHit[] {
  const re = global(pattern)
  const out: PlaceholderHit[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0]) {
      re.lastIndex++
      continue
    }
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  return out
}

export const countPlaceholders = (text: string, pattern: RegExp = PLACEHOLDER_PATTERN): number => findPlaceholders(text, pattern).length
