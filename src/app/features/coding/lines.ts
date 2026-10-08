/**
 * The worker's own log lines in the person's language: a line with a known code (`c`) is shown from
 * `features.coding.log.c.<code>` with its values (`v`); every other line — Claude's text, tool calls, test
 * output, an older worker — as the worker wrote it (`s`).
 */
import type { Translate } from '@/shared/i18n'
import { EDIT_CHARS, EDIT_HUNKS, type LogLine, type ToolEdit } from './protocol'

export const LOG_CODES = new Set([
  'stage',
  'icloud',
  'branch',
  'reuse',
  'starting',
  'claudeStarted',
  'stillWorking',
  'claudeDone',
  'claudeEnded',
  'stopped',
  'claudeAuth',
  'fetching',
  'fetchFailed',
  'newBranch',
  'checkout',
  'testsRun',
  'testsPass',
  'testsFail',
  'committed',
  'nothingToCommit',
  'pushed',
  'docDiff',
  'analyzeNone',
  'analyzeRun',
  'analyzeClean',
  'analyzeFound',
  'reviewPosted',
  'requestMerged',
  'modelOne',
  'modelRepo',
  'modelDefault',
])

const CODE = /^[a-zA-Z][a-zA-Z.]{0,40}$/

/** A line as it arrives from the worker: the code kept only when known, its values only as short strings / numbers. */
export function cleanCode(l: { c?: unknown; v?: unknown }): Pick<LogLine, 'c' | 'v'> {
  if (typeof l.c !== 'string' || !CODE.test(l.c) || !LOG_CODES.has(l.c)) return {}
  const v: Record<string, string | number> = {}
  if (l.v && typeof l.v === 'object' && !Array.isArray(l.v))
    for (const [k, x] of Object.entries(l.v as Record<string, unknown>).slice(0, 12)) {
      if (!/^[a-zA-Z]{1,20}$/.test(k)) continue
      if (typeof x === 'number' && Number.isFinite(x)) v[k] = x
      else if (typeof x === 'string') v[k] = x.slice(0, 400)
    }
  return { c: l.c, v }
}

export function lineText(t: Translate, l: LogLine): string {
  return l.c && LOG_CODES.has(l.c) ? t(`features.coding.log.c.${l.c}`, l.v) : l.s
}

/** An edit as it arrives from the worker: strings only, within the limits; anything else is dropped. */
export function cleanEdit(raw: unknown): Pick<LogLine, 'e'> {
  if (!raw || typeof raw !== 'object') return {}
  const e = raw as Record<string, unknown>
  if (typeof e.path !== 'string' || !e.path.trim() || !Array.isArray(e.hunks)) return {}
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, EDIT_CHARS) : '')
  const hunks = e.hunks
    .slice(0, EDIT_HUNKS)
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h) => ({ old: str(h.old), new: str(h.new) }))
    .filter((h) => h.old || h.new)
  if (!hunks.length) return {}
  const edit: ToolEdit = { path: e.path.slice(0, 400), hunks, ...(e.clipped === true ? { clipped: true } : {}) }
  return { e: edit }
}
