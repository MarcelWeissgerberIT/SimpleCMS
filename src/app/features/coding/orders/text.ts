/**
 * Work orders — the press's reasons in words (the plate's strip, toasts, ⌘K). Each says what to do, without a prefix;
 * 'offline' is the worker link's own reason (codingConnText, as Preflight's worker card says it).
 */
import { t, currentLang } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { stepNo } from './words'
import type { StartRefusal } from './confirm'
import { useCoding } from '../state'
import { workerDownText } from '../stateText'
import { outdatedNotice } from '../outdated'
import type { OrderPreKind, OrderPreWhy } from './pre'
import type { KindProblem } from './preconditions'
import type { PlanOutcome } from './planner'

export function preWhyText(why: OrderPreWhy | 'running' | 'gone' | 'planning' | 'asked' | 'shared', left: OrderPreKind[] = []): string {
  const s = useCoding.getState()
  switch (why) {
    case 'offline':
      return s.enabled && s.conn !== 'connected' && s.conn !== 'off' ? workerDownText(t, s) : t('features.coding.order.why.offline')
    case 'outdated':
      return outdatedNotice(t, s.can)
    case 'unsafe':
      return t('features.coding.worker.unsafe', { version: s.worker?.worker ?? '?' })
    case 'readOnly':
      return t('features.coding.setup.readOnly')
    case 'asked':
      return t('features.coding.order.remote.asked')
    case 'noProject':
      return t('features.coding.order.why.noProject', { list: left.map((k) => `${t(`features.coding.pipe.${k.kind}`)}: ${problemText(k.problem)}`).join(' · ') || '—' })
    default:
      return t(`features.coding.order.why.${why}`)
  }
}

export const problemText = (p: KindProblem | null): string => (p ? t(`features.coding.order.problem.${p}`) : '')

const P = 'features.coding.order.planner'
/** Items 1–6: the strip says these from the live preconditions (preWhyText) — a run that ended on one adds nothing. */
const LIVE_WHYS = new Set(['codingOff', 'readOnly', 'elsewhere', 'offline', 'outdated', 'unsafe', 'noRepos', 'noProject'])

/**
 * How the planner's last run in this tab ended, when it made no plan — the plate's strip line (the planner's words,
 * plannerMessages.ts). null: it planned (Kette bereit / Rückfrage), or the live preconditions already say it.
 */
export function outcomeText(out: PlanOutcome, id: string): string | null {
  switch (out.kind) {
    case 'ready':
    case 'questions':
      return null
    case 'blocked': {
      const b = out.block
      if (LIVE_WHYS.has(b.why)) return null
      if (b.why === 'refused') return b.error instanceof Error && b.error.message ? b.error.message : t(`${P}.why.failed`)
      if (b.why === 'ai') return t(`${P}.why.ai`)
      return t(`${P}.why.${b.why}`)
    }
    case 'brake':
      return out.error.message || t('features.coding.order.chip.regler')
    case 'held':
      return t(`${P}.held`, { id })
    case 'stopped':
      return t(`${P}.stopped`)
    case 'failed':
      return t(out.code === 'malformed' ? `${P}.why.malformed` : `${P}.why.failed`)
    default:
      return t(`${P}.why.${out.kind}`)
  }
}

/** "bis Sa 14:30" — when a kept press expires (24 h after it). */
export function untilText(at: number): string {
  const lang = currentLang()
  return new Date(at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Why a start (or "Rest anlegen") was refused, in words. */
export function refusalText(r: StartRefusal | { why: 'taken' }, tr: (key: string, vars?: Record<string, string | number>) => string = t): string {
  const t = tr
  const O = 'features.coding.order'
  switch (r.why) {
    case 'pre': {
      const b = r.block
      if (b.why === 'offline') return b.text || preWhyText('offline')
      if (b.why === 'noProject') return preWhyText('noProject', b.unusable.map((u) => ({ kind: u.kind, project: null, problem: u.problem })))
      return preWhyText(b.why as OrderPreWhy)
    }
    case 'kind':
      return t(`${O}.start.why.kind`, { n: stepNo(r.step), problem: problemText(r.problem) })
    case 'draft': {
      const issue = r.issues[0]
      return t(`${O}.start.why.draft`, { n: stepNo(r.step), problem: issue ? t(`${O}.draft.${issue.code}`, { repo: '', branch: '', ...(issue.vars ?? {}) }) : '' })
    }
    case 'repo':
      return t(`${O}.start.why.repo`, { n: stepNo(r.step) })
    case 'props':
      return t(`${O}.start.why.props.${r.result}`, { n: stepNo(r.step) })
    case 'failed':
      return t(`${O}.start.why.failed`, { n: stepNo(r.step), error: r.error })
    case 'taken':
      return t(`${O}.undo.taken`)
    case 'source': {
      const row = useWorkspace.getState().pages[r.page]
      if (row?.databaseId && useWorkspace.getState().databases[row.databaseId]?.system === 'workorders') return t(`${O}.start.why.source.row`)
      return t(`${O}.start.why.source.page`, { title: (!row || row.private ? '' : row.title.trim()) || t('common.untitled') })
    }
    case 'unconfirmed':
      return t(`${O}.start.why.unconfirmed`, { n: stepNo(r.step) })
    default:
      return t(`${O}.start.why.${r.why}`)
  }
}
