/**
 * The worker's own log lines in the person's language: a line with a known code (`c`) is shown from
 * `features.coding.log.c.<code>` with its values (`v`); every other line — Claude's text, tool calls, test
 * output, an older worker — as the worker wrote it (`s`).
 */
import type { Lang, Translate } from '@/shared/i18n'
import { currentLang } from '../../i18n'
import { fmtUsd } from '../../lib/money'
import { budgetSet } from '../governor'
import { logValues } from './logValues'
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
  'projectSettingsOff',
  'projectSettingsOffSet',
  'projectSettingsOffCloned',
  'projectSettingsOffImported',
  'projectSettingsOffMarked',
  'projectSettingsOffFolder',
  'mcpUserScope',
  // worker 1.9.0: synced folders, git's sign-in / SSH / lock hints, Claude Code or a command that did not start
  'onedrive',
  'cloudStorage',
  'longpaths',
  'sshHostKey',
  'sshKey',
  'gitSignIn',
  'dubiousOwnership',
  'gitLock',
  'gitIdentity',
  'folderBusy',
  'claudeMissing',
  'claudeCmdRefused',
  'commandMissing',
  'commandRefused',
  // a Claude Code stage that does not start: a program a lookup by name could take at the top of its folder (Windows)
  'plantedProgram',
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

/** Lines whose `cost` value is the worker's number in US dollars ("0.05"): One formats it in the UI's language. */
const COST_CODES = new Set(['claudeDone', 'claudeEnded'])

/**
 * A line in the person's language — `lang`: the language `t` speaks (money: "$0.05" · "0,05 $", lib/money.ts; the
 * worker's own number is parsed here — no worker change).
 */
export function lineText(t: Translate, l: LogLine, lang: Lang = currentLang()): string {
  if (!l.c || !LOG_CODES.has(l.c)) return l.s
  const v = l.v ?? {}
  if (COST_CODES.has(l.c) && v.cost !== undefined) {
    const n = typeof v.cost === 'number' ? v.cost : Number(String(v.cost).trim())
    const line = t(`features.coding.log.c.${l.c}`, { ...v, cost: Number.isFinite(n) && String(v.cost).trim() !== '' ? fmtUsd(n, lang) : String(v.cost) })
    // Claude Code runs on the person's own subscription: with a budget set, the line says it is not counted
    return budgetSet() ? `${line} · ${t('features.governor.cost.worker')}` : line
  }
  return t(`features.coding.log.c.${l.c}`, logValues(l.c, v, (key) => t(key)))
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
