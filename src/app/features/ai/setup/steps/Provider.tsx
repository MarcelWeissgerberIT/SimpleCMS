/**
 * Step 01 — providers (UX § 4.2): three plates in registry order (Claude · OpenAI · OpenRouter; OpenAI "comes soon"
 * until slice 4), each with its switch "Set up <P>", or — ready — Change key · Remove …. Two notes below: Combine and
 * the Jev Router (shown by default — owner update b). Next: ≥ 1 provider picked or ready; nothing picked and one ready
 * → straight to step 03 (changing models). Switching OpenRouter on is what first reads its model list (D-S2-34).
 */
import { useEffect, useState } from 'react'
import { Network, Workflow } from 'lucide-react'
import type { ProviderId } from '@/shared/ai/types'
import { PROVIDER_ORDER } from '@/shared/ai/providers'
import { useWorkspace } from '../../../../store/store'
import { useUI } from '../../../../store/ui'
import { useT } from '../../../../i18n'
import { hasKeyIn, keyedState, PLATE_ORDER, plateState, receivesNothing, useChecks } from '../facts'
import { ProviderPlate } from '../ProviderPlate'
import { RemovePanel } from '../remove'
import { Rich } from '../AINeedsSetup'
import type { StepProps } from '../AISetup'

/** OpenRouter picked: its public model list is read now (once a day at most — core/catalog.ts). */
export function warmCatalog(): void {
  void import('../../core/catalog').then((m) => m.loadCatalog()).catch(() => {})
}

export function ProviderStep({ run, setRun, handle, go }: StepProps) {
  const t = useT()
  const settings = useWorkspace((s) => s.settings)
  const wsAI = useWorkspace((s) => s.ai)
  const checks = useChecks()
  const [removing, setRemoving] = useState<ProviderId | null>(null)
  const ready = PROVIDER_ORDER.filter((p) => hasKeyIn(settings, p))
  const can = run.picked.length > 0 || ready.length > 0

  useEffect(() => {
    handle({ canNext: can })
  }, [can, handle])

  const pick = (p: ProviderId, on: boolean) => {
    setRun((r) => ({ picked: on ? [...new Set([...r.picked, p])] : r.picked.filter((x) => x !== p), skipped: r.skipped.filter((x) => x !== p), tab: on ? p : r.tab }))
    if (on && p === 'openrouter') warmCatalog()
  }

  return (
    <>
      <p className="aiw-lead">
        <Rich text={t('features.ai.prov.setup.lead')} />
      </p>
      <div className="pplates">
        {PLATE_ORDER.map((p) => {
          const state = plateState(p, { hasKey: hasKeyIn(settings, p), picked: run.picked.includes(p), check: checks[p], empty: receivesNothing(p, wsAI, settings.ai) })
          const ready = keyedState(state)
          return (
            <ProviderPlate
              key={p}
              p={p}
              state={state}
              onPick={(on) => pick(p, on)}
              footNote={state === 'soon' ? t('features.ai.prov.plate.soon') : t('features.ai.prov.plate.foot')}
              keys={
                ready ? (
                  removing === p ? (
                    <RemovePanel
                      p={p}
                      onCancel={() => setRemoving(null)}
                      onDone={(msg, undo) => {
                        setRemoving(null)
                        // the rules it cleared come back with Undo (as in Settings › AI); the key itself cannot
                        useUI.getState().toast({ message: msg, kind: 'info', ...(undo ? { action: { label: t('features.ai.prov.remove.undo'), run: undo } } : {}) })
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn--sm"
                        data-testid={`plate-${p}-key`}
                        onClick={() => {
                          setRun({ tab: p })
                          go('key')
                        }}
                      >
                        {state === 'ready' || state === 'empty' ? t('features.ai.prov.plate.change') : t('features.ai.prov.plate.check')}
                      </button>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRemoving(p)} data-testid={`plate-${p}-remove`}>
                        {t('features.ai.prov.plate.remove')}
                      </button>
                    </>
                  )
                ) : undefined
              }
            />
          )
        })}
      </div>
      <div className="aiw-notes">
        <p className="aiw-note" data-testid="note-combine">
          <Workflow size={15} strokeWidth={1.7} aria-hidden />
          <span>
            <Rich text={t('features.ai.prov.note.combine')} />
          </span>
        </p>
        <p className="aiw-note" data-testid="note-jev">
          <Network size={15} strokeWidth={1.7} aria-hidden />
          <span>
            <Rich text={t('features.ai.prov.note.jev')} />
          </span>
        </p>
      </div>
    </>
  )
}
