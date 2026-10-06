/**
 * #/scripts — the workspace's scripts and queries as instrument rows: code (SC-01), name, kind, the
 * last run on this device (LED, when, what), and keys to dry-run / run a script right from the list.
 * Below: a few templates to start from (they point at a real database of the workspace) and the key to
 * the whole template gallery ("From template", ⌘K "New script from template…").
 */
import { useEffect, useMemo } from 'react'
import { ArrowRight, FlaskConical, LayoutTemplate, Play, Plus, Square } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { OneScript } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { PageIcon } from '../../../ui/PageIcon'
import { useLang, useT } from '../../../i18n'
import { HelpLink } from '../../../help'
import { createScript } from '../actions'
import { TEMPLATES } from '../templates/catalog'
import { openTemplateGallery } from '../templates/open'
import { TemplateGallery, createFromTemplate } from './Gallery'
import { runScriptById, stopScript, useActiveRuns } from '../runtime/active'
import { loadScriptRuns, scriptScope, useScriptRuns } from '../runtime/runs'
import { pad2 } from './format'

/** The templates the list offers right away (the gallery has them all). */
const FEATURED = ['query', 'overdue', 'raise', 'counts']

const TEMPLATE_CAT_LINE = (t: ReturnType<typeof useT>) => (['tasks', 'mail', 'reports', 'cleanup', 'claude'] as const).map((c) => t(`features.script.tpl.cat.${c}`)).join(' · ')

function useScripts(): OneScript[] {
  const scripts = useWorkspace((s) => s.scripts)
  return useMemo(() => Object.values(scripts ?? {}).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)), [scripts])
}

function when(at: number, lang: string): string {
  const d = new Date(at)
  const same = d.toDateString() === new Date().toDateString()
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  return same ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(loc, { day: '2-digit', month: 'short' })
}

function ScriptRow({ script, n }: { script: OneScript; n: number }) {
  const t = useT()
  const lang = useLang()
  const readOnly = useCloud((s) => s.readOnly)
  const scope = scriptScope()
  const last = useScriptRuns((s) => s.byScript[`${scope}|${script.id}`]?.[0])
  const active = useActiveRuns((s) => s.runs[script.id])
  useEffect(() => {
    void loadScriptRuns(script.id, scope)
  }, [script.id, scope])
  const led = active ? 'led led--on sc-led--live' : !last ? 'led' : last.status === 'ok' ? 'led led--ok' : last.status === 'error' ? 'led sc-led--err' : 'led'
  const href = `#/scripts/${script.id}`
  const firstLine = script.description?.trim() || script.code.split('\n').find((l) => /^\s*(#|\/\/)/.test(l))?.replace(/^\s*(#|\/\/)\s*/, '') || ''
  return (
    <li className="sc-row" data-kind={script.kind} data-testid="sc-row">
      <span className="sc-row__code label">SC-{pad2(n)}</span>
      <a className="sc-row__name" href={href}>
        {script.icon && <PageIcon icon={script.icon} size={16} />}
        <span>{script.name}</span>
      </a>
      <span className={`sc-chip-kind label sc-chip-kind--${script.kind}`}>{t(`features.script.kind.${script.kind}`)}</span>
      <span className="sc-row__desc">{firstLine}</span>
      <span className="sc-row__last label">
        <span className={led} aria-hidden />
        {active ? t('features.script.status.running') : last ? `${t(`features.script.mode.${last.mode}`)} · ${t(`features.script.status.${last.status}`)} · ${when(last.at, lang)}` : t('features.script.neverRun')}
      </span>
      <span className="sc-row__keys">
        {script.kind === 'script' ? (
          active ? (
            <button type="button" className="btn btn--sm" onClick={() => stopScript(script.id)}>
              <Square size={11} strokeWidth={2} aria-hidden /> {t('features.script.stop')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => void runScriptById(script.id, { mode: 'dry' })} aria-label={t('features.script.dryNamed', { name: script.name })}>
                <FlaskConical size={13} strokeWidth={1.8} aria-hidden /> <span className="sc-hide-narrow">{t('features.script.dry')}</span>
              </button>
              {!readOnly && (
                <button type="button" className="btn btn--sm" onClick={() => void runScriptById(script.id)} aria-label={t('features.script.runNamed', { name: script.name })}>
                  <Play size={11} strokeWidth={2} aria-hidden /> <span className="sc-hide-narrow">{t('features.script.run')}</span>
                </button>
              )}
            </>
          )
        ) : (
          <a className="btn btn--sm btn--ghost" href={href}>
            {t('features.script.open')}
          </a>
        )}
      </span>
    </li>
  )
}

export function ScriptList() {
  const t = useT()
  const lang = useLang()
  const scripts = useScripts()
  const readOnly = useCloud((s) => s.readOnly)
  const nQuery = scripts.filter((s) => s.kind === 'query').length
  const featured = FEATURED.map((id) => ({ id, n: TEMPLATES.findIndex((x) => x.id === id) + 1, kind: TEMPLATES.find((x) => x.id === id)?.kind ?? 'script' }))
  return (
    <div className="sc">
      <header className="sc-head">
        <div className="sc-head__meta label">
          <span className="sc-head__sec">§ SC</span>
          <span>{t('features.script.kicker')}</span>
          <span className="sc-head__rule" aria-hidden />
          <span className="mono" data-testid="sc-count">
            {t('features.script.count', { s: pad2(scripts.length - nQuery), q: pad2(nQuery) })}
          </span>
          <HelpLink id="one-script" />
        </div>
        <div className="sc-head__row">
          <h1 className="sc-title">{t('features.script.title')}</h1>
          {!readOnly && (
            <div className="sc-keys">
              <button type="button" className="btn" onClick={() => openTemplateGallery()} data-testid="sc-new-template">
                <LayoutTemplate size={14} strokeWidth={1.8} aria-hidden /> {t('features.script.tpl.button')}
              </button>
              <button type="button" className="btn" onClick={() => createScript('query')} data-testid="sc-new-query">
                <Plus size={14} strokeWidth={1.9} aria-hidden /> {t('features.script.newQuery')}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => createScript('script')} data-testid="sc-new">
                <Plus size={14} strokeWidth={1.9} aria-hidden /> {t('features.script.new')}
              </button>
            </div>
          )}
        </div>
        <p className="sc-lead">{t('features.script.lead')}</p>
        {readOnly && <p className="sc-note">{t('features.script.readOnly')}</p>}
      </header>
      {scripts.length > 0 && (
        <ul className="sc-rows" aria-label={t('features.script.title')}>
          {scripts.map((s, i) => (
            <ScriptRow key={s.id} script={s} n={i + 1} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <section className="sc-start" aria-labelledby="sc-start-title">
          <h2 id="sc-start-title" className="sc-start__title label">
            {t('features.script.startTitle')}
          </h2>
          <ul className="sc-examples">
            {featured.map((ex) => (
              <li key={ex.id}>
                <button type="button" className="sc-example" onClick={() => createFromTemplate(ex.id, lang, t(`features.script.tpl.${ex.id}.name`))} data-example={ex.id}>
                  <span className="sc-example__code label">TP-{pad2(ex.n)}</span>
                  <span className="sc-example__text">
                    <span className="sc-example__name">{t(`features.script.tpl.${ex.id}.name`)}</span>
                    <span className="sc-example__desc">{t(`features.script.tpl.${ex.id}.desc`)}</span>
                  </span>
                  <span className={`sc-chip-kind label sc-chip-kind--${ex.kind}`}>{t(`features.script.kind.${ex.kind}`)}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="sc-example sc-example--all" onClick={() => openTemplateGallery()} data-testid="sc-templates-all">
                <span className="sc-example__code label">TP</span>
                <span className="sc-example__text">
                  <span className="sc-example__name">{t('features.script.tpl.allButton', { n: TEMPLATES.length })}</span>
                  <span className="sc-example__desc">{TEMPLATE_CAT_LINE(t)}</span>
                </span>
                <ArrowRight size={14} strokeWidth={1.8} aria-hidden />
              </button>
            </li>
          </ul>
        </section>
      )}
      <TemplateGallery />
    </div>
  )
}
