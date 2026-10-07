/**
 * "Then" on a Business analysis / QA task: which pipelines it hands on to when it is done (Business analysis →
 * Coding and / or QA, QA → Coding) — toggled before, and once done: the follow-up tasks it made (links), or a key
 * to hand on now. Every chain also runs on its own: nothing ticked, nothing follows.
 */
import { ArrowRight } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { useTaskLocal } from './local'
import { FOLLOW_UPS, type PipelineKind } from './schema'
import { followUpsOf, setFollowUps, spawnFollowUp } from './tasks'

export function FollowUps({ taskId, kind, done, canAct }: { taskId: ID; kind: PipelineKind; done: boolean; canAct: boolean }) {
  const t = useT()
  // re-read the "Then" field when the row changes
  useWorkspace((s) => s.pages[taskId]?.properties)
  const local = useTaskLocal(taskId)
  const offers = FOLLOW_UPS[kind]
  if (!offers.length) return null
  const picked = followUpsOf(taskId)
  const spawned = local.spawned ?? {}
  const pages = useWorkspace.getState().pages

  const handOn = (k: PipelineKind) => {
    void spawnFollowUp(taskId, k)
      .then((id) => {
        if (id) useUI.getState().toast({ message: t('features.coding.follow.made', { kind: t(`features.coding.pipe.${k}`) }), kind: 'success' })
      })
      .catch((e: unknown) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' }))
  }

  return (
    <div className="ctk-then" data-testid="coding-then">
      <span className="label ctk-then__label">{t('features.coding.prop.followUps')}</span>
      <div className="ctk-then__keys" role="group" aria-label={t('features.coding.prop.followUps')}>
        {offers.map((k) => {
          const made = spawned[k as 'coding' | 'qa']
          if (made && pages[made] && !pages[made]!.trashed)
            return (
              <a key={k} href={`#/p/${made}`} className="btn btn--sm ctk-then__made" data-testid={`coding-then-open-${k}`}>
                {t(`features.coding.pipe.${k}`)} <ArrowRight size={13} strokeWidth={1.75} aria-hidden />
              </a>
            )
          if (done)
            return canAct ? (
              <button key={k} type="button" className="btn btn--sm" onClick={() => handOn(k)} data-testid={`coding-then-make-${k}`}>
                {t('features.coding.follow.now', { kind: t(`features.coding.pipe.${k}`) })}
              </button>
            ) : null
          const on = picked.includes(k)
          return (
            <button
              key={k}
              type="button"
              className="ctk-then__opt"
              aria-pressed={on}
              disabled={!canAct}
              onClick={() => setFollowUps(taskId, on ? picked.filter((x) => x !== k) : [...picked, k])}
              data-testid={`coding-then-${k}`}
            >
              <span className="ctk-then__box" aria-hidden />
              {t(`features.coding.pipe.${k}`)}
            </button>
          )
        })}
      </div>
      <span className="ctk-hint">{t(done ? 'features.coding.follow.doneHint' : picked.length ? 'features.coding.follow.onHint' : 'features.coding.follow.offHint')}</span>
    </div>
  )
}
