import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, X, GitBranch, HardDrive } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { Modal } from '../../ui/Modal'
import { Led, Switch } from '../../ui/controls'
import { SecretField } from '../../ui/SecretField'
import { useLang, useT } from '../../i18n'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import type { ThemePref } from '../../store/types'
import { ShortcutList } from '../modals/ShortcutsModal'
import { runAI, SyncTab, consumeSyncSettingsRequest, McpTab, consumeMcpSettingsRequest, McpServers, MailTab, consumeMailSettingsRequest, CodingWorkerTab, consumeCodingSettingsRequest } from '../../features'
import { ServerAgentsSettings } from '../../features'
import { MemorySettings } from '../../features'
import { plural } from '../lib/format'
import { WebClipper } from '../capture/WebClipper'
import { InstallSection } from '../capture/Install'
import { AccountNameField } from '../cloud/Team'
import { ServerTab } from '../cloud/ServerTab'
import { useInCloud, useWorkspaceTitle } from '../cloud/state'
import { openWorkspaceSettings } from '../workspace/open'
import { StorageGauge, useStorageEstimate } from './data'
import { TextSizeControl } from './TextSize'
import { cloudApi } from '../cloud/api'
import { errorText } from '../cloud/errors'
import { useCloud, useCloudSync } from '../../cloud'
import { HelpLink } from '../../help'
import './settings.css'

/**
 * Settings = this device and your account (language, theme, Claude key, sync, mail, MCP, the coding worker,
 * shortcuts). What belongs to the workspace — its name, people and members, invites, building blocks,
 * automation, backup / export / import, leaving or deleting it — is on the workspace page (#/workspace,
 * shell/workspace), linked at the top of the rail.
 */
export type SettingsTab = 'general' | 'server' | 'appearance' | 'ai' | 'data' | 'sync' | 'mail' | 'mcp' | 'coding' | 'shortcuts' | 'about'
const BASE_TABS: SettingsTab[] = ['general', 'appearance', 'ai', 'data', 'sync', 'mail', 'mcp', 'coding', 'shortcuts', 'about']
/** Server admins (ADMIN_EMAILS) also get "Server" (registration links) — after General. */
const withServer = (tabs: SettingsTab[], admin: boolean): SettingsTab[] => (admin ? [tabs[0], 'server', ...tabs.slice(1)] : tabs)

export const AI_MODELS = [
  { id: 'claude-opus-5-5', key: 'shell.ai.opus' },
  { id: 'claude-sonnet-5-5', key: 'shell.ai.sonnet' },
  { id: 'claude-haiku-4-5', key: 'shell.ai.haiku' },
]

export function SettingsModal({ initialTab, onClose }: { initialTab?: SettingsTab | 'team'; onClose: () => void }) {
  // "Team" moved to the workspace page: an old entry point (a link, a hand-off) lands on its People section
  const team = initialTab === 'team'
  useEffect(() => {
    if (!team) return
    onClose()
    openWorkspaceSettings('people')
  }, [team, onClose])
  if (team) return null
  return <Settings initialTab={initialTab} onClose={onClose} />
}

function Settings({ initialTab, onClose }: { initialTab?: SettingsTab; onClose: () => void }) {
  const t = useT()
  const serverAdmin = useCloud((c) => !!c.user && !!c.serverAdmin)
  const TABS = withServer(BASE_TABS, serverAdmin)
  const [tab, setTab] = useState<SettingsTab>(() => {
    const asked = initialTab ?? (consumeSyncSettingsRequest() ? 'sync' : null) ?? (consumeMcpSettingsRequest() ? 'mcp' : null) ?? (consumeMailSettingsRequest() ? 'mail' : null) ?? (consumeCodingSettingsRequest() ? 'coding' : null)
    return asked && TABS.includes(asked) ? asked : 'general'
  })
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
          <div className="st__rail-head label">{t('shell.ws.settings.head')}</div>
          <WorkspaceLink onClose={onClose} />
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
            {tab === 'server' && <ServerTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'ai' && <AITab />}
            {tab === 'data' && <DataTab onClose={onClose} />}
            {tab === 'sync' && <SyncTab />}
            {tab === 'mail' && <MailTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'mcp' && <ServerAgentsSettings />}
            {tab === 'coding' && <CodingWorkerTab />}
            {tab === 'shortcuts' && <ShortcutList />}
            {tab === 'about' && <AboutTab />}
          </div>
        </section>
      </div>
    </Modal>
  )
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

/** "WORKSPACE · <name> →": the workspace's own settings live on the workspace page (#/workspace). */
function WorkspaceLink({ onClose }: { onClose: () => void }) {
  const t = useT()
  const name = useWorkspaceTitle()
  return (
    <a
      className="st__ws"
      href="#/workspace"
      data-testid="settings-workspace-link"
      onClick={(e) => {
        e.preventDefault()
        onClose()
        openWorkspaceSettings()
      }}
    >
      <span className="st__ws-text">
        <span className="label">{t('shell.ws.settings.wsLabel')}</span>
        <span className="st__ws-name">{t('shell.ws.settings.link')}</span>
        <span className="st__ws-sub">{name}</span>
      </span>
      <ArrowRight size={14} aria-hidden />
    </a>
  )
}

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-labelledby'?: string; role?: string }

/**
 * Label + hint + control. A single input/select/textarea child gets an id (so the label
 * names it) and the hint as its description; a control nested deeper passes `htmlFor`
 * and sets that id (and aria-describedby `${htmlFor}-hint`) itself; a radiogroup child is
 * named via aria-labelledby.
 */
export function Field({ label, hint, children, inline, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean; htmlFor?: string }) {
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
    } else if (tag === Switch && hintId) {
      // a switch keeps its own name (aria-label); the hint describes it
      control = cloneElement(children as ReactElement<{ describedBy?: string }>, { describedBy: hintId })
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
  // the workspace's name lives on the workspace page (#/workspace); a team workspace's account name here
  const inCloud = useInCloud()
  const s = useWorkspace((x) => x.settings)
  const pages = useWorkspace((x) => x.pages)
  const set = useWorkspace.getState().updateSettings
  const candidates = Object.values(pages)
    .filter((p) => !p.trashed && !p.databaseId && !isEffectivelyTrashed(pages, p.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  return (
    <>
      <h3 className="st-h">{t('shell.ws.settings.generalTitle')}</h3>
      {inCloud ? (
        <AccountNameField />
      ) : (
        <Field label={t('shell.settings.userName')} hint={t('shell.settings.userNameHint')}>
          <input className="input" value={s.userName} maxLength={40} placeholder={t('shell.settings.userNamePh')} onChange={(e) => set({ userName: e.target.value })} />
        </Field>
      )}
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
        <Switch seed="spellcheck" checked={s.spellcheck} onChange={(v) => set({ spellcheck: v })} label={t('shell.settings.spellcheck')} />
      </Field>
      <InstallSection />
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
      <div className="st-textsize">
        <TextSizeControl />
      </div>
    </>
  )
}

function AITab() {
  const t = useT()
  // a vault marker ('' = no key): the key itself is never in the store (store/secrets.ts)
  const key = useWorkspace((x) => x.settings.aiApiKey)
  const model = useWorkspace((x) => x.settings.aiModel)
  const set = useWorkspace.getState().updateSettings
  const [draft, setDraft] = useState('')
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
      // the key alone: no MCP server is attached to this check
      await runAI({ action: 'custom', input: '', instruction: 'Reply with the single word OK.', signal: ctrl.signal, mcp: false })
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
      <h3 className="st-h">
        {t('shell.settings.ai.title')} <HelpLink id="claude-key" />
      </h3>
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
        <SecretField
          id={keyId}
          label={t('shell.settings.ai.key')}
          marker={key}
          value={draft}
          onChange={setDraft}
          onSubmit={(k) => {
            set({ aiApiKey: k })
            setDraft('')
          }}
          onRemove={() => set({ aiApiKey: '' })}
          placeholder="sk-ant-…"
          describedBy={`${keyId}-hint`}
          showLabel={t('shell.settings.ai.show')}
          hideLabel={t('shell.settings.ai.hide')}
        />
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
      <McpServers />
      <MemorySettings />
    </>
  )
}

function DataTab({ onClose }: { onClose: () => void }) {
  const t = useT()
  const interval = useWorkspace((x) => x.settings.historyIntervalMin)
  const set = useWorkspace.getState().updateSettings
  const est = useStorageEstimate()
  const inCloud = useInCloud()
  return (
    <>
      <h3 className="st-h">
        {t('shell.ws.settings.dataTitle')} <HelpLink id="export" />
      </h3>
      <p className="st-p">{inCloud ? t('shell.ws.settings.dataBodyTeam') : t('shell.ws.settings.dataBody')}</p>
      <a
        className="st-moved"
        href="#/workspace/data"
        data-testid="settings-data-moved"
        onClick={(e) => {
          e.preventDefault()
          onClose()
          openWorkspaceSettings('data')
        }}
      >
        <span className="st-note__mark" aria-hidden />
        <span className="st-moved__text">
          <strong>{t('shell.ws.settings.movedTitle')}</strong>
          <span>{t('shell.ws.settings.movedBody')}</span>
        </span>
        <ArrowRight size={14} aria-hidden />
      </a>
      <StorageGauge est={est} label={t('shell.ws.settings.deviceStorage')} />
      <Field label={t('shell.settings.data.snapshots')} hint={t('shell.settings.data.snapshotsHint')}>
        <select className="input" value={interval} onChange={(e) => set({ historyIntervalMin: Number(e.target.value) })}>
          {[1, 2, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {t('shell.settings.data.everyMin', { n: m })}
            </option>
          ))}
        </select>
      </Field>
      <WebClipper />
      {/* a team workspace is not this browser's to erase: only its copy here can go (the local reset is on the workspace page) */}
      {inCloud && <RemoveCopy onClose={onClose} />}
    </>
  )
}

/** Cloud workspace: remove this browser's copy (the server keeps the workspace). */
function RemoveCopy({ onClose }: { onClose: () => void }) {
  const t = useT()
  const workspace = useWorkspaceTitle()
  const wsId = useCloud((c) => (c.active.kind === 'cloud' ? c.active.id : null))
  if (!wsId) return null
  const ask = () => {
    onClose()
    const sync = useCloudSync.getState()
    const lost = sync.unsynced || sync.pendingUploads > 0
    useUI.getState().openModal({
      type: 'confirm',
      title: t('shell.cloud.copy.confirmTitle', { workspace }),
      body: lost ? `${t('shell.cloud.copy.confirmBody')} ${t('shell.cloud.copy.confirmUnsynced')}` : t('shell.cloud.copy.confirmBody'),
      danger: true,
      confirmLabel: t('shell.cloud.copy.confirm'),
      onConfirm: () => {
        cloudApi.removeDeviceCopy(wsId).catch((e) => useUI.getState().toast({ message: errorText(e, t), kind: 'error' }))
      },
    })
  }
  return (
    <div className="danger" data-testid="remove-copy">
      <div className="danger__stripes" aria-hidden />
      <div className="danger__text">
        <div className="label danger__label">
          <HardDrive size={12} /> {t('shell.cloud.copy.label')}
        </div>
        <strong>{t('shell.cloud.copy.title')}</strong>
        <p>{t('shell.cloud.copy.body', { workspace })}</p>
      </div>
      <button type="button" className="btn btn--danger-solid" onClick={ask}>
        {t('shell.cloud.copy.button')}
      </button>
    </div>
  )
}

/** When this build was made, in the reader's language (dev: now). */
function buildStamp(lang: string): string {
  const at = new Date(import.meta.env.VITE_BUILD_TIME || Date.now())
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
}

function AboutTab() {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((x) => Object.keys(x.pages).length)
  return (
    <div className="about">
      <div className="about__plate">
        <span className="about__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(56) }} />
        <div>
          <div className="display about__name">{BRAND.name}</div>
          <div className="label">
            {t('shell.about.version', { v: BRAND.version })} · {t('shell.about.build', { at: buildStamp(lang) })} · {t(plural('shell.about.records', pages), { n: pages })}
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

