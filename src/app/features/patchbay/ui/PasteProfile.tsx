/**
 * Paste a profile (plan §1.12, §6 U25): a dialog with the shared CodeArea (never a plain textarea) — JSON highlighted,
 * each problem marked at its line and listed under the field — then the same checks as a dropped file; a profile whose
 * id is there already asks first ("Replaces “Tracker”" · Replace).
 */
import { useState } from 'react'
import { Modal } from '../../../ui/Modal'
import { CodeArea, tokenizeJson, type CodeMarker } from '../../../ui/code'
import type { Translate } from '@/shared/i18n'
import { checkDropText, type DropReady } from '../setup/drop'
import { refusalText, type DropFlow } from './DropFlow'

const P = 'features.patchbay'

/** The paste dialog: the shared CodeArea (JSON highlighted, problems marked at their line), then the same checks. */
export function PasteProfile({ t, flow }: { t: Translate; flow: DropFlow }) {
  const [text, setText] = useState('')
  const [markers, setMarkers] = useState<CodeMarker[]>([])
  const [said, setSaid] = useState<string | null>(null)
  const [ask, setAsk] = useState<DropReady | null>(null)
  const close = () => {
    setText('')
    setMarkers([])
    setSaid(null)
    setAsk(null)
    flow.closePaste()
  }
  const check = () => {
    setAsk(null)
    if (!text.trim()) {
      setSaid(t(`${P}.drop.paste.empty`))
      setMarkers([])
      return
    }
    const c = checkDropText(text)
    if (!c.ok) {
      // the problems are marked in the code area (line, column, sentence) — the line under it only counts them
      const n = c.problems.length + c.more
      setSaid(c.why === 'invalid' ? t(n === 1 ? `${P}.drop.paste.invalid.one` : `${P}.drop.paste.invalid`, { n }) : refusalText(t, c))
      setMarkers(c.problems.map((p) => ({ line: p.line, col: p.col, severity: 'error' as const, message: p.message })))
      return
    }
    setMarkers([])
    setSaid(null)
    if (c.replaces) {
      setAsk(c)
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="pb-paste-replace"]')?.focus())
      return
    }
    if (flow.commit(c)) close()
  }
  return (
    <Modal
      open={flow.paste}
      onClose={close}
      title={t(`${P}.drop.paste.title`)}
      label="JSON"
      width={640}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={close}>
            {t('common.cancel')}
          </button>
          {ask ? (
            <button type="button" className="btn btn--primary" onClick={() => flow.commit(ask) && close()} data-testid="pb-paste-replace">
              {t(`${P}.drop.replace.go`)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={check} data-testid="pb-paste-check">
              {t(`${P}.drop.paste.check`)}
            </button>
          )}
        </>
      }
    >
      <div className="pb-paste" data-testid="pb-paste">
        <p className="pb-paste__hint" id="pb-paste-hint">
          {t(`${P}.drop.paste.hint`)}
        </p>
        <CodeArea
          value={text}
          onChange={(v) => {
            setText(v)
            if (ask) setAsk(null)
          }}
          tokenize={tokenizeJson}
          markers={markers}
          lineNumbers
          wrap={false}
          minRows={10}
          maxRows={20}
          brackets="match"
          enter="indent"
          storageKey="patchbay.paste"
          ariaLabel={t(`${P}.drop.paste.field`)}
          describedBy="pb-paste-hint"
          invalid={markers.length > 0}
          testId="pb-paste-area"
        />
        {said && (
          <p className="pb-paste__said" role="status" data-testid="pb-paste-said">
            {said}
          </p>
        )}
        {ask && (
          <p className="pb-paste__ask" role="status" data-testid="pb-paste-ask">
            <b>{t(`${P}.band.replaces`, { name: ask.replaces?.name ?? ask.profile.id })}</b> — {t(`${P}.drop.replace.ask`, { id: ask.profile.id })}
          </p>
        )}
      </div>
    </Modal>
  )
}
