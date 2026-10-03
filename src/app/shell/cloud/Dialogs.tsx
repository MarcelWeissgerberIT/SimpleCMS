import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Check, CornerDownLeft, X } from 'lucide-react'
import { useCloud, type CloudWorkspace } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { Modal } from '../../ui/Modal'
import { useLang, useT } from '../../i18n'
import { fmtNumber } from '../lib/format'
import { cloudApi } from './api'
import { errorText } from './errors'
import { CheckInbox, SignInForm, useSignInFlow } from './SignIn'
import { closeCloudDialog, useCloudUI } from './state'
import './cloud.css'

/** Host for the cloud dialogs (ModalState only knows the core modals). Mount once in the workspace. */
export function CloudDialogs() {
  const dialog = useCloudUI((s) => s.dialog)
  if (dialog === 'new-workspace') return <NewWorkspaceDialog />
  if (dialog === 'sign-in') return <SignInDialog />
  return null
}

function DialogHead({ label, onClose, closable = true }: { label: string; onClose: () => void; closable?: boolean }) {
  const t = useT()
  return (
    <header className="cl-dlg__head">
      <span className="label">{label}</span>
      {closable && (
        <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      )}
    </header>
  )
}

/* ------------------------------------------------------------------ sign in (from local mode) */

function SignInDialog() {
  const t = useT()
  const flow = useSignInFlow()
  const user = useCloud((s) => s.user)
  // the magic link may be opened in another tab of this browser: once signed in, carry on
  useEffect(() => {
    if (user) useCloudUI.setState({ dialog: 'new-workspace' })
  }, [user])
  return (
    <Modal open onClose={closeCloudDialog} width={520} bare className="cl-dlg" ariaLabel={t('shell.cloud.signin.doc')}>
      <DialogHead label={flow.phase === 'form' ? t('shell.cloud.signin.section') : t('shell.cloud.inbox.section')} onClose={closeCloudDialog} />
      <div className="cl-dlg__body">
        {flow.phase === 'form' ? (
          <>
            <h2 className="cl-dlg__title">{t('shell.cloud.new.signInTitle')}</h2>
            <p className="cl-dlg__p">{t('shell.cloud.new.signInBody')}</p>
            <SignInForm flow={flow} />
          </>
        ) : (
          <CheckInbox flow={flow} />
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ new team workspace */

type Step = 'name' | 'content' | 'copy'

function NewWorkspaceDialog() {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const isLocal = useCloud((s) => s.active.kind === 'local')
  const counts = useWorkspace((s) => {
    let pages = 0
    let dbs = 0
    for (const p of Object.values(s.pages)) {
      if (p.trashed || p.databaseId) continue
      if (p.kind === 'database') dbs++
      else pages++
    }
    return `${pages}:${dbs}`
  })
  const [pages, dbs] = counts.split(':').map(Number)
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ws, setWs] = useState<CloudWorkspace | null>(null)
  const [choice, setChoice] = useState<'empty' | 'copy'>(isLocal && pages + dbs > 0 ? 'copy' : 'empty')
  const [progress, setProgress] = useState(0)
  const [copyState, setCopyState] = useState<'running' | 'done' | 'failed'>('running')

  const copying = step === 'copy' && copyState === 'running'
  const close = () => {
    if (!copying) closeCloudDialog()
  }

  const open = (id: string) => {
    closeCloudDialog()
    cloudApi.switchWorkspace({ kind: 'cloud', id })
  }

  const create = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    setError(null)
    try {
      const created = await cloudApi.createWorkspace(n.slice(0, 100))
      setWs(created)
      setStep('content')
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (target: CloudWorkspace) => {
    setStep('copy')
    setCopyState('running')
    setProgress(0)
    setError(null)
    try {
      await cloudApi.uploadLocalWorkspace(target.id, (p) => setProgress(Math.max(0, Math.min(1, p))))
      setProgress(1)
      setCopyState('done')
      window.setTimeout(() => open(target.id), 700)
    } catch (e) {
      setCopyState('failed')
      setError(errorText(e, t))
    }
  }

  const pct = Math.round(progress * 100)
  return (
    <Modal open onClose={close} width={540} bare className="cl-dlg" ariaLabel={t('shell.cloud.new.label')}>
      <DialogHead label={`${t('shell.cloud.new.label')} · ${step === 'name' ? '1' : step === 'content' ? '2' : '3'}/3`} onClose={close} closable={!copying} />

      {step === 'name' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="cl-dlg__body">
            <h2 className="cl-dlg__title">{t('shell.cloud.new.nameTitle')}</h2>
            <div className="cl-dlg__field">
              <label className="label" htmlFor={`${uid}-name`}>
                {t('shell.cloud.new.name')}
              </label>
              <input
                id={`${uid}-name`}
                className="input"
                value={name}
                maxLength={100}
                placeholder={t('shell.cloud.new.namePh')}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={`${uid}-hint`}
                data-autofocus=""
              />
              <span className="cl-dlg__hint" id={`${uid}-hint`}>
                {t('shell.cloud.new.nameHint')}
              </span>
            </div>
            {error && (
              <p className="cl-err" role="alert">
                <AlertTriangle size={13} aria-hidden />
                {error}
              </p>
            )}
          </div>
          <div className="cl-dlg__foot">
            <button type="button" className="btn btn--ghost" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--ink" disabled={busy || !name.trim()}>
              {busy ? t('shell.cloud.new.creating') : t('shell.cloud.new.create')}
              {!busy && <CornerDownLeft size={13} aria-hidden />}
            </button>
          </div>
        </form>
      )}

      {step === 'content' && ws && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (choice === 'copy') void copy(ws)
            else open(ws.id)
          }}
        >
          <div className="cl-dlg__body">
            <p className="cl-dlg__done">
              <Check size={13} aria-hidden />
              {t('shell.cloud.new.created', { name: ws.name })}
            </p>
            <h2 className="cl-dlg__title">{t('shell.cloud.new.contentTitle')}</h2>
            <div className="cl-choices" role="radiogroup" aria-label={t('shell.cloud.new.contentTitle')}>
              <Choice checked={choice === 'empty'} onSelect={() => setChoice('empty')} title={t('shell.cloud.new.empty')} hint={t('shell.cloud.new.emptyHint')} />
              <Choice
                checked={choice === 'copy'}
                onSelect={() => setChoice('copy')}
                title={t('shell.cloud.new.copy')}
                hint={t('shell.cloud.new.copyHint')}
                spec={isLocal ? t('shell.cloud.new.copyCount', { pages: fmtNumber(pages, lang), dbs: fmtNumber(dbs, lang) }) : undefined}
              />
            </div>
          </div>
          <div className="cl-dlg__foot">
            <button type="submit" className="btn btn--primary" data-autofocus="">
              {choice === 'copy' ? t('shell.cloud.new.copyStart') : t('shell.cloud.new.open')}
              <CornerDownLeft size={13} aria-hidden />
            </button>
          </div>
        </form>
      )}

      {step === 'copy' && ws && (
        <>
          <div className="cl-dlg__body">
            <h2 className="cl-dlg__title">{ws.name}</h2>
            <p className="cl-dlg__p">{copyState === 'done' ? t('shell.cloud.new.copyDone') : t('shell.cloud.new.copyKeep')}</p>
            <div className="cl-meter">
              <div className="cl-meter__head">
                <span className="label">{t('shell.cloud.new.copying')}</span>
                <span className="cl-meter__val">{String(pct).padStart(3, ' ')} %</span>
              </div>
              <div
                className="gauge__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={t('shell.cloud.new.copying')}
              >
                <div className="gauge__fill" style={{ width: `${Math.max(pct, 0.6)}%` }} />
                <div className="gauge__ticks" />
              </div>
              <div className="gauge__scale" aria-hidden>
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100%</span>
              </div>
            </div>
            {copyState === 'failed' && error && (
              <p className="cl-err" role="alert">
                <AlertTriangle size={13} aria-hidden />
                {t('shell.cloud.new.copyFailed', { msg: error })}
              </p>
            )}
          </div>
          {copyState === 'failed' && (
            <div className="cl-dlg__foot">
              <button type="button" className="btn btn--ghost" onClick={() => open(ws.id)}>
                {t('shell.cloud.new.openAnyway')}
              </button>
              <button type="button" className="btn btn--ink" onClick={() => void copy(ws)}>
                {t('shell.cloud.new.retry')}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function Choice({ checked, onSelect, title, hint, spec }: { checked: boolean; onSelect: () => void; title: string; hint: string; spec?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      className="cl-choice"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const sib = (e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLButtonElement | null
          sib?.focus()
          sib?.click()
        }
      }}
    >
      <span className="cl-choice__radio" aria-hidden />
      <span>
        <span className="cl-choice__title">{title}</span>
        <span className="cl-choice__hint">{hint}</span>
        {spec && <span className="cl-choice__spec">{spec}</span>}
      </span>
    </button>
  )
}
