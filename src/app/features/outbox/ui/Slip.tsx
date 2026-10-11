/**
 * One slip, open: a paper slip with a perforated top edge — server tag, `tool → #key`, where it came from, the title;
 * the text exactly as it goes out; INPUTS, AFTER, READ; the screwed switch plate (the hand path's steps and key,
 * the lamps); the CHANGED band; the question after Copy & open; the slip's own keys.
 */
import { useState } from 'react'
import { Pause, Play, RefreshCw, SquarePen, X } from 'lucide-react'
import { useUI } from '../../../store/ui'
import { localized } from '../../../store/integrations'
import { Screws } from '../../../ui/controls'
import { currentLang, useLang, useT, t as translate } from '../../../i18n'
import { ackChanged, toggleHold, withdrawSlip } from '../actions'
import { redraft } from '../draft'
import { copyAndOpen, markBlock, markSent, notYet } from '../hand'
import { isForeign } from '../counts'
import { getSlip, useOutbox } from '../store'
import { unsent } from '../machine'
import type { Slip as SlipT } from '../types'
import { After } from './After'
import { ChangedBand } from './ChangedBand'
import { AskSent, HandPlate } from './HandPlate'
import { Inputs } from './Inputs'
import { Lamps } from './Lamps'
import { OriginChip, ServerTag, Shown, ToolTarget } from './parts'
import { focusSlipEl } from '../keys'
import { Payload } from './Payload'
import { Sources } from './Sources'

/** Copy & open, with what happened as a toast. */
export async function runCopy(slip: SlipT): Promise<void> {
  const res = await copyAndOpen(slip.id)
  const ui = useUI.getState()
  if (!res.ok) return void ui.toast({ message: translate(`features.outbox.block.${res.refused}`), kind: 'error' })
  if (!res.copied && slip.draft) ui.toast({ message: translate('features.outbox.hand.copyFailed'), kind: 'error' })
  else if (!res.opened) ui.toast({ message: translate('features.outbox.hand.noLink', { server: slip.target.serverName }) })
}

export async function runMarkSent(slip: SlipT, after?: () => void): Promise<void> {
  const cur = getSlip(slip.id)
  const block = cur ? markBlock(cur) : 'state'
  if (block) return void useUI.getState().toast({ message: translate(`features.outbox.block.${block}`), kind: 'error' })
  const done = await markSent(slip.id)
  if (!done) return
  const label = localized(done.route.label, currentLang()) || done.route.routeId
  useUI.getState().toast({ message: translate('features.outbox.hand.sentToast', { label, key: done.target.key }), kind: 'success' })
  after?.()
}

export async function runRedraft(slip: SlipT, setBusy: (b: boolean) => void): Promise<void> {
  setBusy(true)
  const res = await redraft(slip.id)
  setBusy(false)
  // it answers seconds later — maybe over a dialog the person opened meanwhile: a background toast waits for it
  if (!res.ok) useUI.getState().toast({ message: translate('features.outbox.act.redraftFailed', { detail: res.detail }), kind: 'error', timeout: 8000, background: true })
}

/** `onGone`: the slip left the open ones (sent, withdrawn) — focus moves on (the next slip, else the dock's heading). */
export function SlipCard({ slip, editing, onEditing, onGone }: { slip: SlipT; editing: boolean; onEditing: (on: boolean) => void; onGone?: () => void }) {
  const t = useT()
  const lang = useLang()
  const asking = useOutbox((s) => s.asking?.id === slip.id)
  const drafting = useOutbox((s) => Object.values(s.drafting).some((d) => d.rowId === slip.target.rowId))
  const [busy, setBusy] = useState(false)
  const foreign = isForeign(slip)
  const open = unsent(slip.state)
  return (
    <article className="obx-slip" data-foreign={foreign || undefined} data-state={slip.state} aria-labelledby={`obx-t-${slip.id}`} data-slip={slip.id} data-testid="outbox-slip" tabIndex={-1}>
      <div className="obx-slip__head">
        <ServerTag name={slip.target.serverName} />
        <ToolTarget slip={slip} />
        <span className="obx-sp" />
        <OriginChip slip={slip} lang={lang} />
      </div>
      <h3 className="obx-slip__title" id={`obx-t-${slip.id}`}>
        <Shown text={slip.title} />
      </h3>
      <Payload slip={slip} editing={editing} onEditing={onEditing} />
      <div className="obx-kv">
        <span className="label obx-kv__k">{t('features.outbox.inputs')}</span>
        <Inputs slip={slip} />
        <span className="label obx-kv__k">{t('features.outbox.after')}</span>
        <After slip={slip} />
        <span className="label obx-kv__k">{t('features.outbox.read')}</span>
        <Sources slip={slip} />
      </div>
      <div className="obx-plate screw-plate">
        <Screws seed={slip.id} />
        <HandPlate slip={slip} onCopy={() => void runCopy(slip)} />
        <Lamps slip={slip} />
      </div>
      <ChangedBand slip={slip} busy={busy || drafting} onHold={() => void toggleHold(slip.id)} onRedraft={() => void runRedraft(slip, setBusy)} onAnyway={() => void ackChanged(slip.id)} />
      {asking && slip.state === 'ready' && (
        <AskSent
          slip={slip}
          onYes={() => void runMarkSent(slip, onGone)}
          onNo={() => {
            notYet(slip.id)
            focusSlipEl(slip.id)
          }}
        />
      )}
      {open && (
        <div className="obx-slip__acts">
          {slip.state !== 'missing' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEditing(!editing)} aria-pressed={editing}>
              <SquarePen size={13} aria-hidden />
              {t('features.outbox.act.edit')}
              <kbd className="kbd obx-fine">E</kbd>
            </button>
          )}
          {(slip.state === 'ready' || slip.state === 'held') && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void toggleHold(slip.id)} data-testid="outbox-hold-key">
              {slip.state === 'held' ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
              {slip.state === 'held' ? t('features.outbox.act.release') : t('features.outbox.act.hold')}
              <kbd className="kbd obx-fine">H</kbd>
            </button>
          )}
          {slip.draft && slip.state !== 'missing' && slip.draft.by !== 'person' && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy || drafting} onClick={() => void runRedraft(slip, setBusy)}>
              <RefreshCw size={13} aria-hidden />
              {t('features.outbox.act.redraft')}
              <kbd className="kbd obx-fine">R</kbd>
            </button>
          )}
          <span className="obx-sp" />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={async () => {
              if ((await withdrawSlip(slip.id, 'person')) !== 'withdrawn') return
              useUI.getState().toast({ message: translate('features.outbox.act.withdrawn') })
              onGone?.()
            }}
            data-testid="outbox-withdraw"
          >
            <X size={13} aria-hidden />
            {t('features.outbox.act.withdraw')}
          </button>
        </div>
      )}
    </article>
  )
}
