/**
 * The "Transform into …" half of the AI panel (AIMenu.tsx), like image/ImagePanel: for a transform run it gives
 * the body (the preview: strip of forms, options, the result, what stays) and the Transform key; the panel keeps
 * its keyboard flow (Enter = Transform, ←/→ in the empty prompt = the previous / next form, Esc = close).
 *
 * A form asked before comes back from the run's cache without a request; another form (or another diagram
 * kind / column count) is a new run that takes the place of this one and keeps the cache (runs.ts startRun).
 */
import { useRef, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import { Kbd } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { setTransform, useAIRuns, type AIRun, type RunRequest } from '../runs'
import type { RunTarget } from '../runsTarget'
import type { BlockRange, TableDraft } from '../todb/plan'
import { sameBlocks, TodbError, type TodbIssue } from '../todb/run'
import { applyTransform } from './apply'
import { TRANSFORM_ICONS, transformRequest, typeLabel } from './forms'
import { fitsAt, fittingTypes } from './range'
import { TransformPreview } from './TransformPreview'
import { resultKey, shownResult, TRANSFORM_TYPES, type TransformOpts, type TransformType } from './types'

/** A row of the panel's list (the shape AIMenu renders). */
export interface TransformRow {
  id: string
  label: ReactNode
  code?: string
  icon?: LucideIcon
  run: () => void
  hint?: ReactNode
}

export interface TransformPanelOptions {
  editor: Editor
  pageId: string
  run: AIRun | null
  phase: 'idle' | 'streaming' | 'done' | 'error'
  target: RunTarget
  /** a new run in place of this one (another form, Try again, Revise) */
  start: (req: RunRequest) => void
  /** the result is in the page: the run is done with, the panel closes */
  finish: () => void
  /** applying failed (the text changed, the page went away …) */
  onIssue: (issue: TodbIssue) => void
}

export interface TransformPanel {
  /** the body under the output bar (null: not a transform run) */
  body: ReactNode
  /** the Transform key of a finished run (null: nothing to apply) */
  apply: TransformRow | null
  /** Try again (the form shown, asked anew) / Revise with an instruction */
  again: (instruction?: string) => void
  /** ←/→: the previous / next form — true when it was the panel's */
  step: (dir: -1 | 1) => boolean
  /** which result shows: the panel's highlight goes back to the first key when it changes */
  mode: string
}

/** Blocks between the positions of a range (the wait line counts them). */
function countBlocks(editor: Editor, range: BlockRange | null): number {
  if (!range || editor.isDestroyed) return 0
  try {
    const $a = editor.state.doc.resolve(range.from)
    const $b = editor.state.doc.resolve(range.to)
    return $a.sameParent($b) ? Math.max(0, $b.index() - $a.index()) : 0
  } catch {
    return 0
  }
}

export function useTransformPanel({ editor, pageId, run, phase, target, start, finish, onIssue }: TransformPanelOptions): TransformPanel {
  const t = useT()
  const applying = useRef(false)
  const req = run?.req.kind === 'transform' ? run.req : null
  if (!req || !run) return { body: null, apply: null, again: () => {}, step: () => false, mode: '' }

  const st = run.transform ?? null
  const busy = phase === 'streaming'
  const range = target.lost ? null : (target.range ?? null)
  // the forms that may go where the blocks are (every form once they are gone: the result goes to the end)
  const fits = editor.isDestroyed ? [] : fittingTypes(fitsAt(editor.state.doc, range))
  const forms: TransformType[] = fits.length ? fits : [...TRANSFORM_TYPES]
  const res = shownResult(st)
  const blocks = res ? (res.type === 'db' ? res.table.blocks : res.blocks) : null
  const inPlace = !!blocks && !!range && !editor.isDestroyed && !!sameBlocks(editor.state.doc, range, blocks)
  const asking: TransformType | null = st?.shown ?? (req.pick === 'auto' ? null : req.pick)

  const doApply = async () => {
    if (!st || applying.current || editor.isDestroyed) return
    const r = shownResult(st)
    if (!r) return
    const tg = useAIRuns.getState().runs[run.id]?.target ?? target
    const own = r.type === 'db' ? r.table.blocks : r.blocks
    const at = !tg.lost && tg.range && sameBlocks(editor.state.doc, tg.range, own) ? tg.range : null
    applying.current = true
    try {
      await applyTransform(editor, pageId, at, st)
      finish()
    } catch (e) {
      applying.current = false
      onIssue(e instanceof TodbError ? e.issue : 'bad')
    }
  }

  /** Another form: from the cache when it was asked before, else asked now. */
  const pick = (type: TransformType) => {
    if (busy || (st?.shown === type && phase === 'done')) return
    if (st && st.results[resultKey(type, st.opts)]) setTransform(run.id, (s) => ({ ...s, shown: type }))
    else start(transformRequest(type))
  }

  /** Options: the local ones (direction, chart kind, keep the original) change the preview; a diagram kind / column count not asked before is a new request. */
  const setOpts = (patch: Partial<TransformOpts>) => {
    if (busy || !st) return
    const next = { ...st.opts, ...patch }
    const asked = (patch.diagram !== undefined && patch.diagram !== st.opts.diagram) || (patch.columns !== undefined && patch.columns !== st.opts.columns)
    if (!asked || !st.shown || st.results[resultKey(st.shown, next)]) return setTransform(run.id, (s) => ({ ...s, opts: { ...s.opts, ...patch } }))
    start(transformRequest(st.shown, { diagram: patch.diagram, columns: patch.columns }))
  }

  const setDraft = (draft: TableDraft) =>
    setTransform(run.id, (s) => {
      if (!s.shown) return s
      const key = resultKey(s.shown, s.opts)
      const r = s.results[key]
      return r?.type === 'db' ? { ...s, results: { ...s.results, [key]: { ...r, table: { ...r.table, draft } } } } : s
    })

  const again = (instruction?: string) => start(transformRequest(st?.shown ?? req.pick, { fresh: true, instruction: instruction?.trim() || req.instruction }))

  const step = (dir: -1 | 1) => {
    if (busy || phase === 'idle' || forms.length < 2) return false
    const i = asking ? forms.indexOf(asking) : -1
    pick(forms[i < 0 ? (dir > 0 ? 0 : forms.length - 1) : (i + dir + forms.length) % forms.length])
    return true
  }

  const n = countBlocks(editor, range ?? target.range ?? null)
  const wait = asking
    ? t(n === 1 ? 'features.ai.transform.wait.typeOne' : 'features.ai.transform.wait.type', { n, type: typeLabel(asking) })
    : t(n === 1 ? 'features.ai.transform.wait.autoOne' : 'features.ai.transform.wait.auto', { n })

  const body = (
    <>
      <TransformPreview
        state={st}
        forms={forms}
        asking={asking}
        busy={busy}
        wait={busy ? wait : null}
        issue={phase === 'error' ? (run.transformIssue ?? null) : null}
        onPick={pick}
        onOpts={setOpts}
        onDraft={setDraft}
        onApply={() => void doApply()}
      />
      {phase === 'done' && res && !inPlace && (
        <p className="ai-lost" role="note" data-testid="ai-lost">
          {t('features.ai.transform.lost')}
        </p>
      )}
    </>
  )

  const shown = st?.shown ?? null
  const apply: TransformRow | null =
    phase === 'done' && res && shown
      ? {
          id: 'transform-apply',
          label: inPlace ? t('features.ai.transform.apply') : t('features.ai.transform.applyEnd'),
          code: typeLabel(shown).toUpperCase(),
          icon: TRANSFORM_ICONS[shown],
          run: () => void doApply(),
          hint: <Kbd>↵</Kbd>,
        }
      : null

  return { body, apply, again, step, mode: `${run.id}:${phase}:${shown ?? ''}` }
}
