/**
 * Where the content preview of a staged change ends (ReviewParts Preview): whole blocks up to PREVIEW_LINES lines —
 * never inside a code fence. Pure: the custom agents' review asks it whether a proposal's body was shown in full.
 */
export const PREVIEW_LINES = 10

export interface PreviewCut {
  lines: string[]
  /** the lines shown: lines.slice(0, end) */
  end: number
  /** the lines left out (0: shown in full) */
  rest: number
}

export function previewCut(markdown: string): PreviewCut {
  const lines = markdown.trim().split('\n')
  let end = Math.min(lines.length, PREVIEW_LINES)
  const fences = lines.slice(0, end).filter((l) => /^\s*```/.test(l)).length
  if (fences % 2) {
    const close = lines.findIndex((l, i) => i >= end && /^\s*```/.test(l))
    end = close >= 0 ? close + 1 : lines.length
  }
  return { lines, end, rest: lines.length - end }
}
