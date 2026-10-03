/**
 * Settings → Sync: two instrument panels (FOLDER · GITHUB), a run log, and the layout spec.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Eye, EyeOff, ExternalLink, FolderOpen, FolderSync, Download, RefreshCw, ArrowUpFromLine, ArrowDownToLine, Unplug, KeyRound } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useCloud } from '../../cloud'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { countOf } from '../io/count'
import {
  connectFolder,
  disconnectFolder,
  disconnectGitHub,
  pullGitHub,
  pushGitHub,
  resolveMissing,
  resumeFolder,
  syncFolder,
  testGitHub,
  updateGitHubConfig,
  useSync,
  type FolderState,
  type GitHubState,
} from './service'
import type { GitHubConfig, LogEntry } from './types'
import './sync.css'

type T = ReturnType<typeof useT>

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export function fmtWhen(at: number | null, lang: string, t: T): string {
  if (!at) return t('features.sync.never')
  const d = new Date(at)
  const locale = lang === 'de' ? 'de-DE' : 'en-US'
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  if (new Date().toDateString() === d.toDateString()) return time
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }).toUpperCase()} ${time.slice(0, 5)}`
}

function ledOf(state: FolderState | GitHubState, pending = 0): 'off' | 'on' | 'ok' {
  if (state === 'running' || state === 'permission') return 'on'
  if (state === 'ready') return pending > 0 ? 'on' : 'ok'
  return 'off'
}

function Panel({ id, code, title, state, stateText, pending = 0, children }: { id: string; code: string; title: string; state: FolderState | GitHubState; stateText: string; pending?: number; children: ReactNode }) {
  return (
    <section className="sy-panel" aria-labelledby={`${id}-h`} data-state={state}>
      <header className="sy-panel__head">
        <span className="label sy-panel__code" id={`${id}-h`}>
          {code} — {title}
        </span>
        <span className="sy-panel__state" role="status">
          <Led state={ledOf(state, pending)} />
          <span className="label">{stateText}</span>
        </span>
      </header>
      <div className="sy-panel__body">{children}</div>
    </section>
  )
}

function Readout({ cells }: { cells: Array<[string, ReactNode]> }) {
  return (
    <dl className="sy-readout">
      {cells.map(([k, v]) => (
        <div key={k} className="sy-readout__cell">
          <dt className="label">{k}</dt>
          <dd className="sy-readout__val">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ */
/* Folder                                                              */
/* ------------------------------------------------------------------ */

function FolderPanel() {
  const t = useT()
  const lang = useLang()
  const f = useSync((s) => s.folder)
  const uid = useId()
  const connected = f.state !== 'off' && f.state !== 'unsupported'
  const stateText = t(`features.sync.state.${f.state}`)
  return (
    <Panel id={uid} code="§ A" title={t('features.sync.folder.label')} state={f.state} stateText={stateText}>
      {f.state === 'unsupported' ? (
        <div className="sy-empty">
          <p>{t('features.sync.folder.unsupported')}</p>
          <button type="button" className="btn" onClick={() => useUI.getState().openModal({ type: 'export', pageId: null })}>
            <Download size={14} /> {t('features.sync.folder.export')}
          </button>
        </div>
      ) : !connected ? (
        <div className="sy-empty">
          <p>{t('features.sync.folder.hint')}</p>
          <button type="button" className="btn btn--primary" onClick={() => void connectFolder()}>
            <FolderOpen size={14} /> {t('features.sync.folder.choose')}
          </button>
        </div>
      ) : (
        <>
          <Readout
            cells={[
              [t('features.sync.ro.folder'), <span className="sy-readout__name">{f.name ?? '—'}/</span>],
              [t('features.sync.ro.last'), fmtWhen(f.lastAt, lang, t)],
              [t('features.sync.ro.files'), f.files.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')],
              [t('features.sync.ro.pending'), String(f.pending)],
            ]}
          />
          {f.state === 'permission' && <p className="sy-msg">{t('features.sync.folder.permission', { name: f.name ?? '' })}</p>}
          {f.state === 'error' && f.error && (
            <p className="sy-msg sy-msg--err" role="alert">
              {f.error}
            </p>
          )}
          <div className="sy-actions">
            {f.state === 'permission' ? (
              <button type="button" className="btn btn--primary" onClick={() => void resumeFolder()}>
                <KeyRound size={14} /> {t('features.sync.folder.resume')}
              </button>
            ) : (
              <>
                <button type="button" className="btn" disabled={f.state === 'running'} onClick={() => void syncFolder({ manual: true })}>
                  <RefreshCw size={14} /> {t('features.sync.folder.syncNow')}
                </button>
                <button type="button" className="btn" disabled={f.state === 'running'} onClick={() => void syncFolder({ pickup: true, manual: true })} data-action="pickup">
                  <FolderSync size={14} /> {t('features.sync.folder.pickup')}
                </button>
              </>
            )}
            <span className="sy-actions__gap" />
            <button type="button" className="btn btn--ghost" onClick={() => void connectFolder()}>
              {t('features.sync.folder.change')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => void disconnectFolder()}>
              <Unplug size={14} /> {t('features.sync.disconnect')}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

function GhField({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div className="sy-field">
      <label className="sy-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && (
        <div className="sy-field__hint" id={`${htmlFor}-hint`}>
          {hint}
        </div>
      )}
    </div>
  )
}

function GitHubPanel() {
  const t = useT()
  const lang = useLang()
  const g = useSync((s) => s.github)
  const loaded = useSync((s) => s.loaded)
  const uid = useId()
  const [draft, setDraft] = useState<GitHubConfig>(g.config)
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  // the saved config arrives after the first render (IndexedDB)
  useEffect(() => setDraft(g.config), [loaded, g.config])
  const commit = (patch: Partial<GitHubConfig>) => void updateGitHubConfig(patch)
  const field = (k: 'repo' | 'branch' | 'prefix' | 'token') => ({
    id: `${uid}-${k}`,
    'aria-describedby': `${uid}-${k}-hint`,
    value: draft[k],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value }),
    onBlur: () => draft[k] !== g.config[k] && commit({ [k]: k === 'token' ? draft[k].trim() : draft[k] }),
    onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => e.key === 'Enter' && e.currentTarget.blur(),
    spellCheck: false,
    autoComplete: 'off',
  })
  const configured = g.state !== 'off'
  const stateText =
    g.state === 'ready' && g.pending > 0 ? t('features.sync.state.pendingN', { n: g.pending }) : g.state === 'ready' && !g.lastAt ? t('features.sync.state.gh.connected') : t(`features.sync.state.gh.${g.state}`)
  const runTest = async () => {
    setTesting(true)
    // fields that are still being edited count
    await updateGitHubConfig({ ...draft, token: draft.token.trim() })
    await testGitHub()
    setTesting(false)
  }
  return (
    <Panel id={uid} code="§ B" title="GitHub" state={g.state} stateText={stateText} pending={g.pending}>
      <div className="sy-grid">
        <GhField label={t('features.sync.gh.repo')} hint={t('features.sync.gh.repoHint')} htmlFor={`${uid}-repo`}>
          <input className="input sy-mono" placeholder={t('features.sync.gh.repoPh')} {...field('repo')} />
        </GhField>
        <GhField label={t('features.sync.gh.branch')} hint={t('features.sync.gh.branchHint')} htmlFor={`${uid}-branch`}>
          <input className="input sy-mono" placeholder="main" {...field('branch')} />
        </GhField>
        <GhField label={t('features.sync.gh.prefix')} hint={t('features.sync.gh.prefixHint')} htmlFor={`${uid}-prefix`}>
          <input className="input sy-mono" placeholder={t('features.sync.gh.prefixPh')} {...field('prefix')} />
        </GhField>
        <GhField
          label={t('features.sync.gh.token')}
          htmlFor={`${uid}-token`}
          hint={
            <>
              {t('features.sync.gh.tokenHint')}{' '}
              <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener" className="st-link">
                {t('features.sync.gh.createToken')} <ExternalLink size={11} />
              </a>
            </>
          }
        >
          <div className="keyfield">
            <input className="input keyfield__input" type={show ? 'text' : 'password'} placeholder="github_pat_…" {...field('token')} />
            <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? t('features.sync.gh.hide') : t('features.sync.gh.show')} aria-pressed={show}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </GhField>
      </div>
      <div className="sy-test">
        <button type="button" className="btn btn--sm" disabled={testing || !draft.repo.trim() || !draft.token.trim()} onClick={() => void runTest()}>
          {testing ? t('features.sync.gh.testing') : t('features.sync.gh.test')}
        </button>
        {g.connection && !testing && (
          <span className="sy-test__ok label" role="status">
            <Led state="ok" />
            {g.connection.branchExists ? t('features.sync.gh.ok', { repo: g.connection.repo }) : t('features.sync.gh.okNewBranch', { repo: g.connection.repo, branch: g.config.branch })}
          </span>
        )}
      </div>
      {g.state === 'error' && g.error && (
        <p className="sy-msg sy-msg--err" role="alert">
          {g.error}
        </p>
      )}
      {configured && (
        <>
          <Readout
            cells={[
              [t('features.sync.ro.repo'), <span className="sy-readout__name">{g.config.repo}</span>],
              [t('features.sync.ro.lastPush'), fmtWhen(g.lastAt, lang, t)],
              [t('features.sync.ro.files'), g.files.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')],
              [t('features.sync.ro.pending'), String(g.pending)],
            ]}
          />
          <div className="sy-actions">
            <button type="button" className="btn btn--primary" disabled={g.state === 'running'} onClick={() => void pushGitHub({ manual: true })}>
              <ArrowUpFromLine size={14} /> {t('features.sync.gh.push')}
            </button>
            <button type="button" className="btn" disabled={g.state === 'running'} onClick={() => void pullGitHub()}>
              <ArrowDownToLine size={14} /> {t('features.sync.gh.pull')}
            </button>
            <span className="sy-actions__gap" />
            <button type="button" className="btn btn--ghost" onClick={() => void disconnectGitHub()}>
              <Unplug size={14} /> {t('features.sync.disconnect')}
            </button>
          </div>
          <div className="sy-auto">
            <Switch checked={g.config.auto} onChange={(v) => commit({ auto: v })} label={t('features.sync.gh.auto')} />
            <span className="sy-auto__text">
              <span className="sy-auto__label">{t('features.sync.gh.auto')}</span>
              <span className="sy-field__hint">{t('features.sync.gh.autoHint')}</span>
            </span>
            <select className="input sy-auto__every" value={g.config.everyMin} disabled={!g.config.auto} aria-label={t('features.sync.gh.interval')} onChange={(e) => commit({ everyMin: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {t('features.sync.gh.every', { n })}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Log, missing files, layout                                          */
/* ------------------------------------------------------------------ */

function SyncLog() {
  const t = useT()
  const lang = useLang()
  const log = useSync((s) => s.log)
  const line = (e: LogEntry) => {
    const vars = { ...(e.vars ?? {}) }
    return t(`features.sync.log.${e.kind}`, vars)
  }
  return (
    <div className="sy-log">
      <div className="sy-log__head label">{t('features.sync.log.title')}</div>
      {log.length ? (
        <ol className="sy-log__list">
          {log.slice(0, 8).map((e, i) => (
            <li key={`${e.at}-${i}`} className="sy-log__row" data-kind={e.kind}>
              <time className="sy-log__time" dateTime={new Date(e.at).toISOString()}>
                {fmtWhen(e.at, lang, t)}
              </time>
              <span className="sy-log__tag">{e.target === 'folder' ? t('features.sync.target.folder') : 'GitHub'}</span>
              <span className="sy-log__text">{line(e)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sy-log__empty">{t('features.sync.log.empty')}</p>
      )}
    </div>
  )
}

function MissingNotice() {
  const t = useT()
  const m = useSync((s) => s.missing)
  if (!m) return null
  return (
    <div className="danger sy-missing" role="alert">
      <div className="danger__stripes" aria-hidden />
      <div className="danger__text">
        <div className="label danger__label">{m.target === 'folder' ? t('features.sync.target.folder') : 'GitHub'}</div>
        <strong>{t('features.sync.missing.title', { files: countOf(t, 'file', m.items.length) })}</strong>
        <p>{t('features.sync.missing.body')}</p>
        <ul className="sy-missing__list">
          {m.items.slice(0, 5).map((it) => (
            <li key={it.path}>{it.path}</li>
          ))}
          {m.items.length > 5 && <li>+{m.items.length - 5}</li>}
        </ul>
        <div className="sy-actions">
          <button type="button" className="btn btn--danger-solid" onClick={() => void resolveMissing(true)}>
            {t('features.sync.missing.trash')}
          </button>
          <button type="button" className="btn" onClick={() => void resolveMissing(false)}>
            {t('features.sync.missing.restore')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LayoutNote() {
  const t = useT()
  return (
    <div className="st-note sy-spec">
      <span className="st-note__mark" aria-hidden />
      <div>
        <strong>{t('features.sync.layout.title')}</strong>
        <p>{t('features.sync.layout.body')}</p>
        <pre className="sy-spec__tree" aria-label={t('features.sync.layout.example')}>
          {t('features.sync.layout.tree')}
        </pre>
      </div>
    </div>
  )
}

export function SyncTab() {
  const t = useT()
  const inCloud = useCloud((c) => c.active.kind === 'cloud')
  return (
    <div className="sy">
      <h3 className="st-h">{t('features.sync.title')}</h3>
      <p className="st-p">{t('features.sync.body')}</p>
      {inCloud && <p className="sy-msg">{t('features.sync.cloudNote')}</p>}
      <MissingNotice />
      <FolderPanel />
      <GitHubPanel />
      <SyncLog />
      <LayoutNote />
    </div>
  )
}
