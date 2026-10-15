/**
 * The closed plate (plan §3.5, §6 U8): after key 1 or 2 the fuse's plate stays for this visit — in ink, never orange —
 * "Fuse F1 · closed — Inbox-Helfer: Apply directly → Proposals for review", what still happens ("applying it still fires
 * „An Team-Chat“"), the team note, "this device only" for a device key, the path as it was, and its Undo key (Mod+Z on
 * the route does the same; the toast's Undo from anywhere). Its heading takes the keyboard after the key. An Undo that
 * is refused ("changed since") says why here, with "Open the editor". After key 2b the read tools still connected that
 * may carry data out stay named ("still connected: …", fix mid).
 */
import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { shortcutLabel } from '../../../ui/controls'
import type { KeyDone } from '../keys'
import { FuseHead } from './FusePlate'
import { FusePath, type PlateWords } from './plateParts'
import { runUndo, UNDO_KBD, wordsOfKey } from './FuseKeys'
import { openTarget } from './open'
import { SLOT } from './slot'
import type { MsgRef, OpenTarget } from '../types'

const P = 'features.patchbay'

export function ClosedPlate({ done, pw: now }: { done: KeyDone; pw: PlateWords }) {
  // the path as it was when the key was pressed (the model now may lack a module it ran through)
  const pw = wordsOfKey(done, now)
  const t = now.w.t
  const [refused, setRefused] = useState<{ refused: MsgRef; open?: OpenTarget } | null>(null)
  const undo = () => {
    setRefused(null)
    // a refusal is said here too (runUndo raises the toast and the polite line)
    const r = runUndo(pw, done.id)
    if (!r.ok) setRefused({ refused: r.refused, ...(r.open ? { open: r.open } : {}) })
  }
  const kbd = shortcutLabel(UNDO_KBD)
  return (
    <div className="pb-fplate pb-closed" data-state="closed" data-pb-closed={done.fuse.key} data-testid="pb-fplate">
      <span className="pb-fplate__tab" aria-hidden="true">
        {done.fuse.label}
      </span>
      <div className="pb-fplate__h">
        <span className="led pb-fuse-led" aria-hidden="true" />
        <h2 className="label pb-fplate__title" id="pb-fplate-h" tabIndex={-1} data-testid="pb-closed-head">
          <FuseHead text={t(`${P}.fuse.closed`, { f: SLOT, what: pw.say(done.what) })} label={done.fuse.label} />
        </h2>
      </div>
      <p className="label pb-closed__static">{t(`${P}.closed.label`, { kbd })}</p>
      {done.note && (
        <p className="pb-fplate__note" data-testid="pb-closed-note">
          {pw.say(done.note)}
        </p>
      )}
      {done.team && <p className="pb-fplate__note">{pw.say(done.team)}</p>}
      {done.device && !done.note && <p className="pb-fplate__note">{t(`${P}.key.deviceOnly`)}</p>}
      {done.residual && done.residual.length > 0 && (
        <p className="pb-fplate__residual" data-testid="pb-closed-residual">
          {t(`${P}.stillConnected`, { tools: done.residual.join(', ') })}
        </p>
      )}
      <FusePath chain={done.chain} pw={pw} hot={false} />
      <div className="pb-closed__keys">
        <button type="button" className="btn pb-closed__undo" onClick={undo} data-testid="pb-closed-undo">
          <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('common.undo')}
          <span className="kbd" aria-hidden="true">
            {kbd}
          </span>
        </button>
        {refused && (
          <span className="pb-fkey__why pb-fkey__why--now" role="status" data-testid="pb-closed-refused">
            {t(`${P}.closed.refused`, { why: pw.say(refused.refused) })}
            {refused.open && (
              <button type="button" className="pb-fkey__open" onClick={() => openTarget(refused.open!)}>
                {t(`${P}.keys.openEditor`)}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
