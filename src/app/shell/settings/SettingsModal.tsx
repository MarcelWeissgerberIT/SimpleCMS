import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, ExternalLink, X, Download, Upload, AlertTriangle, GitBranch } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { Modal } from '../../ui/Modal'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import type { ThemePref } from '../../store/types'
import { ShortcutList } from '../modals/ShortcutsModal'
import { runAI } from '../../features'
import { fmtBytes, plural } from '../lib/format'
import { requestReset } from '../lib/reset'
import './settings.css'

export type SettingsTab = 'general' | 'appearance' | 'ai' | 'data' | 'shortcuts' | 'about'
const TABS: SettingsTab[] = ['general', 'appearance', 'ai', 'data', 'shortcuts', 'about']

export const AI_MODELS = [
  { id: 'claude-opus-5-5', key: 'shell.ai.opus' },
  { id: 'claude-sonnet-5-5', key: 'shell.ai.sonnet' },
  { id: 'claude-haiku-4-5', key: 'shell.ai.haiku' },
]

export function SettingsModal({ initialTab, onClose }: { initialTab?: SettingsTab; onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')
  const idx = TABS.indexOf(tab)
  const uid = useId()
  const stripRef = useRef<HTMLDivElement>(null)
  const tabEl = (id: SettingsTab) => stripRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`) ?? null

  // phones: the rail is a horizontal strip — keep the active tab in view (scroll the strip only)
  useEffect(() => {
    const strip = stripRef.current
    const el = tabEl(tab)
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return
    const left = el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
    const pad = 12
    if (left - pad < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - pad)
    else if (left + el.offsetWidth + pad > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + el.offsetWidth + pad - strip.clientWidth
  }, [tab])

  const select = (next: SettingsTab) => {
    setTab(next)
    tabEl(next)?.focus()
  }

  return (
    <Modal open onClose={onClose} width={860} bare className="st" ariaLabel={t('common.settings')}>
      <div className="st__layout">
        <nav className="st__rail" aria-label={t('common.settings')}>
          <div className="st__rail-head label">{t('common.settings')}</div>
          <div ref={stripRef} role="tablist" aria-orientation="vertical" className="st__tabs">
            {TABS.map((id, i) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${uid}-tab-${id}`}
                data-tab={id}
                aria-selected={tab === id}
                aria-controls={`${uid}-panel`}
                tabIndex={tab === id ? 0 : -1}
                data-autofocus={tab === id ? '' : undefined}
                className="st__tab"
                onClick={() => select(id)}
                onFocus={(e) => {
                  // roving tab stop: the dialog focuses its first button on open and its focus trap
                  // wraps onto the first tab — either way the ring belongs on the tab that is showing
                  if (tab !== id && !stripRef.current?.contains(e.relatedTarget as Node | null)) tabEl(tab)?.focus({ preventScroll: true })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && e.shiftKey) {
                    // the inactive tabs are out of the tab order, so wrap to the dialog's last stop here
                    const dialog = e.currentTarget.closest<HTMLElement>('[role="dialog"]')
                    const stops = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0) : []
                    const last = stops[stops.length - 1]
                    if (stops[0] === e.currentTarget && last && last !== e.currentTarget) {
                      e.preventDefault()
                      last.focus()
                    }
                    return
                  }
                  // vertical rail on desktop, horizontal strip on phones: both arrow pairs move
                  const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
                  if (step) {
                    e.preventDefault()
                    select(TABS[(i + step + TABS.length) % TABS.length])
                  } else if (e.key === 'Home' || e.key === 'End') {
                    e.preventDefault()
                    select(TABS[e.key === 'Home' ? 0 : TABS.length - 1])
                  }
                }}
              >
                <span className="st__tab-n">{String(i + 1).padStart(2, '0')}</span>
                <span>{t(`shell.settings.tab.${id}`)}</span>
              </button>
            ))}
          </div>
        </nav>
        <section className="st__main" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
          <header className="st__head">
            <span className="label">
              § {String(idx + 1).padStart(2, '0')} — {t(`shell.settings.tab.${tab}`)}
            </span>
            <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </header>
          <div className="st__body">
            {tab === 'general' && <GeneralTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'ai' && <AITab />}
            {tab === 'data' && <DataTab onClose={onClose} />}
            {tab === 'shortcuts' && <ShortcutList />}
            {tab === 'about' && <AboutTab />}
          </div>
        </section>
      </div>
    </Modal>
  )
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-labelledby'?: string; role?: string }

/**
 * Label + hint + control. A single input/select/textarea child gets an id (so the label
 * names it) and the hint as its description; a control nested deeper passes `htmlFor`
 * and sets that id (and aria-describedby `${htmlFor}-hint`) itself; a radiogroup child is
 * named via aria-labelledby.
 */
function Field({ label, hint, children, inline, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean; htmlFor?: string }) {
  const uid = useId()
  const id = htmlFor ?? `${uid}-control`
  // a nested control (htmlFor) references its hint as `${htmlFor}-hint`
  const hintId = hint ? `${id}-hint` : undefined
  const labelId = `${uid}-label`
  let control = children
  let labelable = !!htmlFor
  if (isValidElement<ControlProps>(children)) {
    const tag = children.type
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      labelable = true
      control = cloneElement(children, { id: children.props.id ?? id, 'aria-describedby': children.props['aria-describedby'] ?? hintId })
    } else if (children.props.role === 'radiogroup' || children.props.role === 'group') {
      control = cloneElement(children, { 'aria-labelledby': labelId, 'aria-describedby': hintId })
    }
  }
  return (
    <div className="st-field" data-inline={inline || undefined}>
      <div className="st-field__text">
        {labelable ? (
          <label className="st-field__label" id={labelId} htmlFor={id}>
            {label}
          </label>
        ) : (
          <div className="st-field__label" id={labelId}>
            {label}
          </div>
        )}
        {hint && (
          <div className="st-field__hint" id={hintId}>
            {hint}
          </div>
        )}
      </div>
      <div className="st-field__control">{control}</div>
    </div>
  )
}

function GeneralTab() {
  const t = useT()
  const s = useWorkspace((x) => x.settings)
  const pages = useWorkspace((x) => x.pages)
  const set = useWorkspace.getState().updateSettings
  const candidates = Object.values(pages)
    .filter((p) => !p.trashed && !p.databaseId && !isEffectivelyTrashed(pages, p.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  return (
    <>
      <h3 className="st-h">{t('shell.settings.general.title')}</h3>
      <Field label={t('shell.settings.workspaceName')} hint={t('shell.settings.workspaceNameHint')}>
        <input className="input" value={s.workspaceName} maxLength={40} onChange={(e) => set({ workspaceName: e.target.value })} />
      </Field>
      <Field label={t('shell.settings.userName')} hint={t('shell.settings.userNameHint')}>
        <input className="input" value={s.userName} maxLength={40} placeholder={t('shell.settings.userNamePh')} onChange={(e) => set({ userName: e.target.value })} />
      </Field>
      <Field label={t('shell.settings.language')} hint={t('shell.settings.languageHint')}>
        <div className="seg" role="radiogroup">
          {(['en', 'de'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={s.language === l} className="seg__btn" onClick={() => set({ language: l })}>
              <span className="seg__code">{l.toUpperCase()}</span>
              {l === 'en' ? 'English' : 'Deutsch'}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('shell.settings.startPage')} hint={t('shell.settings.startPageHint')}>
        <select className="input" value={s.startPageId ?? ''} onChange={(e) => set({ startPageId: e.target.value || null })}>
          <option value="">{t('shell.settings.startLast')}</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon?.type === 'emoji' ? `${p.icon.value} ` : ''}
              {p.title.trim() || t('common.untitled')}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('shell.settings.spellcheck')} hint={t('shell.settings.spellcheckHint')} inline>
        <Switch checked={s.spellcheck} onChange={(v) => set({ spellcheck: v })} label={t('shell.settings.spellcheck')} />
      </Field>
    </>
  )
}

function ThemePreview({ kind }: { kind: 'light' | 'dark' | 'system' }) {
  return (
    <span className="tp" data-kind={kind} aria-hidden>
      <span className="tp__half tp__half--a">
        <span className="tp__side" />
        <span className="tp__main">
          <span className="tp__bar tp__bar--title" />
          <span className="tp__bar" />
          <span className="tp__bar tp__bar--short" />
          <span className="tp__dot" />
        </span>
      </span>
      {kind === 'system' && (
        <span className="tp__half tp__half--b">
          <span className="tp__side" />
          <span className="tp__main">
            <span className="tp__bar tp__bar--title" />
            <span className="tp__bar" />
            <span className="tp__bar tp__bar--short" />
            <span className="tp__dot" />
          </span>
        </span>
      )}
    </span>
  )
}

function AppearanceTab() {
  const t = useT()
  const theme = useWorkspace((x) => x.settings.theme)
  const set = useWorkspace.getState().updateSettings
  const opts: Array<[ThemePref, string, string]> = [
    ['light', t('shell.theme.light'), 'PAPER'],
    ['dark', t('shell.theme.dark'), 'CARBON'],
    ['system', t('shell.theme.system'), 'AUTO'],
  ]
  return (
    <>
      <h3 className="st-h">{t('shell.settings.appearance.title')}</h3>
      <p className="st-p">{t('shell.settings.appearance.body')}</p>
      <div className="themes" role="radiogroup" aria-label={t('shell.menu.theme')}>
        {opts.map(([id, label, code]) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} className="theme-card" onClick={() => set({ theme: id })}>
            <ThemePreview kind={id === 'system' ? 'system' : id} />
            <span className="theme-card__row">
              <span className="theme-card__radio" />
              <span className="theme-card__label">{label}</span>
              <span className="theme-card__code">{code}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function AITab() {
  const t = useT()
  const key = useWorkspace((x) => x.settings.aiApiKey)
  const model = useWorkspace((x) => x.settings.aiModel)
  const set = useWorkspace.getState().updateSettings
  const [show, setShow] = useState(false)
  const keyId = useId()
  const configured = key.trim().length > 0
  // the key is only "connected" once a real request went through
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; msg?: string }>({ state: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    abort.current?.abort()
    setTest({ state: 'idle' })
  }, [key, model])
  useEffect(() => () => abort.current?.abort(), [])
  const runTest = async () => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setTest({ state: 'running' })
    try {
      await runAI({ action: 'custom', input: '', instruction: 'Reply with the single word OK.', signal: ctrl.signal })
      if (!ctrl.signal.aborted) setTest({ state: 'ok' })
    } catch (e) {
      if (!ctrl.signal.aborted) setTest({ state: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }
  const statusText = !configured
    ? t('shell.ai.notSet')
    : test.state === 'running'
      ? t('shell.ai.testing')
      : test.state === 'ok'
        ? t('shell.ai.verified')
        : test.state === 'error'
          ? t('shell.ai.failed')
          : t('shell.ai.ready')
  return (
    <>
      <h3 className="st-h">{t('shell.settings.ai.title')}</h3>
      <p className="st-p">{t('shell.settings.ai.body')}</p>
      <div className="ai-status" data-state={configured ? test.state : 'none'} role="status">
        <Led state={!configured ? 'off' : test.state === 'running' ? 'on' : test.state === 'ok' ? 'ok' : test.state === 'error' ? 'off' : 'on'} />
        <span className="label">{statusText}</span>
        {configured && (
          <button type="button" className="btn btn--sm ai-status__test" onClick={() => void runTest()} disabled={test.state === 'running'}>
            {test.state === 'running' ? t('shell.ai.testing') : t('shell.ai.test')}
          </button>
        )}
      </div>
      {test.state === 'error' && test.msg && <p className="ai-status__err">{test.msg}</p>}
      <Field label={t('shell.settings.ai.key')} hint={t('shell.settings.ai.keyHint')} htmlFor={keyId}>
        <div className="keyfield">
          <input
            id={keyId}
            aria-describedby={`${keyId}-hint`}
            className="input keyfield__input"
            type={show ? 'text' : 'password'}
            value={key}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set({ aiApiKey: e.target.value.trim() })}
          />
          <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? t('shell.settings.ai.hide') : t('shell.settings.ai.show')} aria-pressed={show}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </Field>
      <Field label={t('shell.settings.ai.model')} hint={t('shell.settings.ai.modelHint')}>
        <select className="input" value={model} onChange={(e) => set({ aiModel: e.target.value })}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.key)}
            </option>
          ))}
        </select>
      </Field>
      <div className="st-note">
        <span className="st-note__mark" aria-hidden />
        <div>
          <strong>{t('shell.settings.ai.privacyTitle')}</strong>
          <p>{t('shell.settings.ai.privacy')}</p>
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener" className="st-link">
            console.anthropic.com <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </>
  )
}

function DataTab({ onClose }: { onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const interval = useWorkspace((x) => x.settings.historyIntervalMin)
  const set = useWorkspace.getState().updateSettings
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => setEst(null))
  }, [])
  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0
  const ui = useUI.getState()
  return (
    <>
      <h3 className="st-h">{t('shell.settings.data.title')}</h3>
      <p className="st-p">{t('shell.settings.data.body')}</p>
      <div className="st-actions">
        <button type="button" className="btn" onClick={() => ui.openModal({ type: 'export', pageId: null })}>
          <Download size={14} />
          {t('shell.settings.data.export')}
        </button>
        <button type="button" className="btn" onClick={() => ui.openModal({ type: 'import' })}>
          <Upload size={14} />
          {t('shell.settings.data.import')}
        </button>
      </div>
      <div className="gauge">
        <div className="gauge__head">
          <span className="label">{t('shell.settings.data.storage')}</span>
          <span className="gauge__val">{est ? `${fmtBytes(est.usage, lang)} / ${fmtBytes(est.quota, lang)}` : '—'}</span>
        </div>
        <div className="gauge__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="gauge__fill" style={{ width: `${Math.max(pct, est ? 0.6 : 0)}%` }} />
          <div className="gauge__ticks" />
        </div>
        <div className="gauge__scale">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100%</span>
        </div>
      </div>
      <Field label={t('shell.settings.data.snapshots')} hint={t('shell.settings.data.snapshotsHint')}>
        <select className="input" value={interval} onChange={(e) => set({ historyIntervalMin: Number(e.target.value) })}>
          {[1, 2, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {t('shell.settings.data.everyMin', { n: m })}
            </option>
          ))}
        </select>
      </Field>
      <div className="danger">
        <div className="danger__stripes" aria-hidden />
        <div className="danger__text">
          <div className="label danger__label">
            <AlertTriangle size={12} /> {t('shell.settings.data.danger')}
          </div>
          <strong>{t('shell.settings.data.reset')}</strong>
          <p>{t('shell.settings.data.resetBody')}</p>
        </div>
        <button
          type="button"
          className="btn btn--danger-solid"
          onClick={() => {
            onClose()
            ui.openModal({
              type: 'confirm',
              title: t('shell.settings.data.resetConfirmTitle'),
              body: t('shell.settings.data.resetConfirmBody'),
              danger: true,
              confirmLabel: t('shell.settings.data.resetConfirm'),
              onConfirm: requestReset,
            })
          }}
        >
          {t('shell.settings.data.reset')}
        </button>
      </div>
    </>
  )
}

function AboutTab() {
  const t = useT()
  const pages = useWorkspace((x) => Object.keys(x.pages).length)
  return (
    <div className="about">
      <div className="about__plate">
        <span className="about__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(56) }} />
        <div>
          <div className="display about__name">{BRAND.name}</div>
          <div className="label">
            {t('shell.about.version', { v: BRAND.version })} · {t(plural('shell.about.records', pages), { n: pages })}
          </div>
        </div>
      </div>
      <p className="st-p">{t('shell.about.body')}</p>
      <dl className="about__spec">
        <div>
          <dt>{t('shell.about.storage')}</dt>
          <dd>IndexedDB · {t('shell.about.local')}</dd>
        </div>
        <div>
          <dt>{t('shell.about.ai')}</dt>
          <dd>Claude · BYOK</dd>
        </div>
        <div>
          <dt>{t('shell.about.built')}</dt>
          <dd>{t('shell.about.armory')}</dd>
        </div>
      </dl>
      <div className="st-actions">
        <a className="btn" href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">
          <GitBranch size={14} /> GitHub
        </a>
        <a className="btn btn--ghost" href={BRAND.homeHref}>
          {t('shell.menu.website')}
        </a>
      </div>
    </div>
  )
}

