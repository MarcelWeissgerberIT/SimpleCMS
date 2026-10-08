/**
 * Custom agents — the first step of a mirror recipe (an active integration profile's RecipeConfig): the source (the
 * MCP servers of this device that match the profile — the first one preselected —, their tool count from the last
 * connection test), a name and the page it goes below (team workspace: a private page, or the Private section's
 * top). "Create" makes the database and its report page (mirror.ts — one toast, one Undo) and hands the agent draft
 * to the editor. The spec plate reads the recipe: properties, views, key, own fields, schedule, budget, report.
 */
import { useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import type { ID, IntegrationProfile, RecipeConfig } from '../../store/types'
import { localTimeZone } from '../../store/agents'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'
import { isReadTool } from './mcpTools'
import { canHoldMirror, createMirror, nameFromServer, type MirrorMade } from './mirror'
import { buildMirror, fillTokens, resolveRecipe } from './integrations/recipe'
import { openIntegrations } from './integrations/open'
import { fmtUsd, triggerText } from './format'
import './agents.css'
import './mirror.css'

/** What the gallery hands the setup: the profile, its recipe, and this device's servers that match it. */
export interface RecipeSource {
  profile: IntegrationProfile
  recipe: RecipeConfig
  /** matching servers (enabled, in list order) — the first one is preselected */
  servers: string[]
}

function WherePicker({ value, onPick, id }: { value: ID | null; onPick: (id: ID | null) => void; id: string }) {
  const t = useT()
  const menu = useMenu()
  const pages = useWorkspace((s) => s.pages)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const list = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => canHoldMirror(pages, p.id, team))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [pages, team],
  )
  const top = team ? t('features.agents.mirror.topPrivate') : t('features.agents.mirror.top')
  const cur = value ? pages[value] : undefined
  const entries: MenuEntry[] = [
    { label: top, checked: !value, onSelect: () => onPick(null) },
    ...list.map((p) => ({ label: p.title.trim() || t('common.untitled'), icon: <PageIcon icon={p.icon} kind={p.kind} size={15} />, checked: p.id === value, onSelect: () => onPick(p.id) })),
  ]
  return (
    <>
      <button type="button" id={id} className="agx-pick" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open}>
        {cur ? <PageIcon icon={cur.icon} kind={cur.kind} size={15} /> : null}
        <span className="agx-pick__text">{cur ? cur.title.trim() || t('common.untitled') : top}</span>
        <ChevronDown size={14} className="faint" aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('common.search')} emptyLabel={t('features.agents.ed.noneFound')} width={300} />
    </>
  )
}

export function MirrorSetup({ source, onClose, onCreated, onUndo }: { source: RecipeSource; onClose: () => void; onCreated: (made: MirrorMade) => void; onUndo: () => void }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const settings = useWorkspace((s) => s.settings)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const recipe = useMemo(() => resolveRecipe(source.profile, source.recipe, lang), [source, lang])
  // the recipe as it builds: its problems block Create (they are listed under Workspace → Integrations)
  const built = useMemo(() => {
    let errors = 0
    const schema = buildMirror(recipe, (i) => {
      if ((i.severity ?? 'error') === 'error') errors++
    })
    return { schema, errors }
  }, [recipe])
  const servers = useMemo(() => readServers(settings).filter((s) => source.servers.includes(s.name)), [settings, source.servers])
  const first = servers[0]
  const [server, setServer] = useState<string>(first?.name ?? '')
  const [name, setName] = useState(() => recipe.dbName || (first ? nameFromServer(first.name) : ''))
  const [named, setNamed] = useState(!!recipe.dbName)
  const [parentId, setParentId] = useState<ID | null>(null)
  const [tried, setTried] = useState(false)
  const [failed, setFailed] = useState('')
  const ids = { name: `${uid}-name`, where: `${uid}-where`, src: `${uid}-src` }

  const errName = tried && !name.trim() ? t('features.agents.mirror.err.name') : ''
  const errServer = tried && !servers.some((s) => s.name === server) ? t('features.agents.mirror.err.server') : ''

  const pickServer = (n: string) => {
    setServer(n)
    // the name follows the source until the person typed one (or the recipe names the database)
    if (!named) setName(nameFromServer(n))
  }

  const create = () => {
    setTried(true)
    setFailed('')
    if (!name.trim() || !servers.some((s) => s.name === server) || built.errors) return
    try {
      onCreated(createMirror({ recipe, server, name, parentId }, { onUndo }))
    } catch (e) {
      setFailed(t('features.agents.mirror.err.failed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  const keyProp = built.schema.properties.find((p) => p.key)
  const yours = built.schema.properties
    .filter((p) => p.agentReadOnly)
    .map((p) => p.name)
    .join(' · ')
  const sched = recipe.agent.schedule
  const when = triggerText(
    t,
    { type: 'schedule', every: sched.every, at: sched.at, tz: localTimeZone(), ...(sched.weekday !== undefined ? { weekday: sched.weekday } : {}), ...(sched.day !== undefined ? { day: sched.day } : {}) },
    { pages, databases, lang },
  )

  return (
    <Modal
      open
      onClose={onClose}
      label={`§ AG-S · ${source.profile.name.toUpperCase()}`}
      title={recipe.name}
      width={640}
      className="agx-mir"
      footer={
        <div className="agx-editor__foot">
          {failed && (
            <p className="agx-editor__errs" role="alert">
              <span className="led agx-led--err" aria-hidden /> {failed}
            </p>
          )}
          <span className="agx-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={create} disabled={!servers.length || built.errors > 0}>
            {t('features.agents.mirror.create')}
          </button>
        </div>
      }
    >
      <form
        className="agx-mir__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <p className="agx-lead agx-lead--modal">{recipe.description || t('features.agents.mirror.lead', { yours: yours || '—' })}</p>
        {built.errors > 0 && (
          <p className="agx-notice agx-mir__none" role="alert" data-testid="agx-mir-broken">
            <span className="led agx-led--err" aria-hidden />
            <span>{t(built.errors === 1 ? 'features.agents.mirror.err.recipeOne' : 'features.agents.mirror.err.recipe', { count: built.errors })}</span>
            <button type="button" className="btn btn--sm btn--ink" onClick={openIntegrations}>
              {t('features.integrations.open')}
            </button>
          </p>
        )}

        <div className="agx-field" data-invalid={errServer ? '' : undefined}>
          <span className="agx-field__label" id={ids.src}>
            <span className="agx-mir__n label">01</span> {t('features.agents.mirror.source')}
          </span>
          <div className="agx-mir__servers" role="radiogroup" aria-labelledby={ids.src}>
            {servers.map((s) => {
              const tools = s.tools ?? []
              const state = tools.length ? t('features.agents.mirror.tools', { n: tools.length, read: tools.filter(isReadTool).length }) : t('features.agents.mirror.untested')
              return (
                <label key={s.id} className="agx-mir__server" data-untested={!tools.length || undefined}>
                  <input type="radio" name={`${uid}-server`} value={s.name} checked={server === s.name} onChange={() => pickServer(s.name)} />
                  <span className="agx-mir__srvname mono">{s.name.toUpperCase()}</span>
                  <span className="agx-mir__srvstate">{state}</span>
                </label>
              )
            })}
          </div>
          <p className="agx-field__hint">{t('features.agents.mirror.sourceHintProfile', { profile: source.profile.name })}</p>
          {errServer && (
            <p className="agx-field__error" role="alert">
              {errServer}
            </p>
          )}
        </div>

        <div className="agx-mir__grid">
          <div className="agx-field" data-invalid={errName ? '' : undefined}>
            <label className="agx-field__label" htmlFor={ids.name}>
              <span className="agx-mir__n label">02</span> {t('features.agents.mirror.name')}
            </label>
            <input
              id={ids.name}
              className="input"
              value={name}
              maxLength={120}
              placeholder={t('features.agents.mirror.namePh')}
              aria-invalid={!!errName || undefined}
              aria-describedby={errName ? `${ids.name}-err` : `${ids.name}-hint`}
              onChange={(e) => {
                setNamed(true)
                setName(e.target.value)
              }}
              data-autofocus=""
            />
            {errName ? (
              <p className="agx-field__error" id={`${ids.name}-err`} role="alert">
                {errName}
              </p>
            ) : (
              <p className="agx-field__hint" id={`${ids.name}-hint`}>
                {t('features.agents.mirror.nameHint')}
              </p>
            )}
          </div>
          <div className="agx-field">
            <label className="agx-field__label" htmlFor={ids.where}>
              <span className="agx-mir__n label">03</span> {t('features.agents.mirror.where')}
            </label>
            <WherePicker id={ids.where} value={parentId} onPick={setParentId} />
            <p className="agx-field__hint">{team ? `${t('features.agents.mirror.whereHint')} ${t('features.agents.mirror.whereTeam')}` : t('features.agents.mirror.whereHint')}</p>
          </div>
        </div>

        <dl className="agx-spec agx-mir__spec" data-testid="agx-mir-spec">
          <div>
            <dt>{t('features.agents.mirror.spec.db')}</dt>
            <dd>{t('features.agents.mirror.spec.dbValue', { props: built.schema.properties.length, views: built.schema.views.length, key: keyProp?.name ?? '—' })}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.yours')}</dt>
            <dd>{yours || '—'}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.agent')}</dt>
            <dd>{t('features.agents.mirror.spec.agentValue', { when, mode: t(recipe.agent.write === 'apply' ? 'features.agents.mirror.spec.apply' : 'features.agents.mirror.spec.stage'), usd: fmtUsd(recipe.agent.budget) })}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.report')}</dt>
            <dd>{fillTokens(recipe.reportName, { db: name.trim() || t('features.agents.mirror.namePh'), server })}</dd>
          </div>
        </dl>
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
