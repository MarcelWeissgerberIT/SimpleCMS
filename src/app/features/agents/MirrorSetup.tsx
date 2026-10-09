/**
 * Custom agents — the first step of a mirror recipe (an active integration profile's RecipeConfig): the source (the
 * MCP servers of this device that match the profile — the first one preselected —, their tool count from the last
 * connection test; the list follows this device's settings live: a server switched off or no longer matching while the
 * setup is open drops out — the picked one (followed by its id through a rename) stays, marked, and the field says what
 * happened to it: switched off, no longer matching the profile (its address, its tools or its name changed — sourceState)
 * or deleted (also when the list is empty then); Create waits), a name and the page it goes below (team
 * workspace: a private page, or the Private section's top). "Create" makes the database and its report page (mirror.ts; the editor's note carries the Undo) and hands the
 * agent draft to the editor. A live database with the same name is never duplicated silently: Create waits, and one
 * holding the recipe's key (named in either language; private in a team) is offered for the agent ("Use …",
 * reuseMirror — the recipe then in the language of its names, the report page this device's setup made for it before,
 * else a new one next to it); one a saved agent mirrors into already (mirrorAgentOf: the agent set up for it, or one
 * that reads any of this device's servers matching the profile — switched on or off; in a team only the member's own
 * agents) offers that agent instead; a shared one in a team only says why it is not used — before anything else. A
 * database of that name in the trash that one of the member's saved agents is marked for is named with Restore and
 * Open that agent (Create waits) — in the trash only because a page above it is: that page is named and restored (“X”
 * is in “P”, and “P” is in the trash · Restore “P”); after Restore focus goes to the Open key that shows then (else the
 * name field). The name's hint says what is named after it (the recipe's agent and report names with `{db}`). The spec
 * plate reads the recipe: properties, views, key, own fields, the agent's name, schedule, budget, report — the names
 * exactly as the offered action makes them (mirrorTitles: Create, or "Use" with the recipe in the database's language
 * and the report page it takes back); while only "Open …" (and Restore) is offered it shows what is there: that agent,
 * its report page ("—": none) and its database. Opening, it takes down the mirror toasts (mirrorToasts.ts).
 */
import { useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import type { ID, IntegrationProfile, McpServerConfig, RecipeConfig } from '../../store/types'
import { localTimeZone } from '../../store/agents'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useLang, useT } from '../../i18n'
import { navigate } from '../../lib/router'
import { LANGS } from '@/shared/i18n'
import { readServers } from '../ai/mcp-servers/config'
import { matchMiss, matchingServers } from '../../store/integrations'
import { isReadTool } from './mcpTools'
import { canHoldMirror, createMirror, mirrorTitles, nameFromServer, reuseMirror, sameNamedDb, type KeyName, type MirrorMade, type SameNamed } from './mirror'
import { useDismissMirrorToasts } from './mirrorToasts'
import { buildMirror, resolveRecipe } from './integrations/recipe'
import { deviceServers } from './integrations/status'
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

/** What became of the picked source (Settings can change while the setup is open). */
type SourceState =
  | { state: 'none' }
  | { state: 'ok' }
  | { state: 'off' }
  | { state: 'mismatch'; why: 'host' | 'tools' | 'untested' | 'name' | 'other'; missing: string[] }
  | { state: 'gone' }

/**
 * `picked`: the picked server as last seen (null: none picked); `current`: its entry in Settings now (null: deleted);
 * `servers`: the profile's sources now (switched on and matching). Switched off · no longer matching the profile (why:
 * its address, its tools, its name) · deleted · fine.
 */
function sourceState(profile: Pick<IntegrationProfile, 'match'>, picked: McpServerConfig | null, current: McpServerConfig | null, servers: McpServerConfig[]): SourceState {
  if (!picked) return { state: 'none' }
  if (!current) return { state: 'gone' }
  if (servers.some((s) => s.id === current.id)) return { state: 'ok' }
  if (!current.enabled) return { state: 'off' }
  const miss = profile.match ? matchMiss(profile.match, { name: current.name, url: current.url, enabled: true, tools: current.tools }) : null
  if (miss?.kind === 'tools') return { state: 'mismatch', why: 'tools', missing: miss.missing }
  return { state: 'mismatch', why: miss && miss.kind !== 'disabled' ? miss.kind : 'other', missing: [] }
}

export function MirrorSetup({ source, onClose, onCreated }: { source: RecipeSource; onClose: () => void; onCreated: (made: MirrorMade) => void }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const settings = useWorkspace((s) => s.settings)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const agents = useWorkspace((s) => s.agents)
  const team = useCloud((s) => s.active.kind === 'cloud')
  // in a team only the member's own agents count as a database's mirror (a teammate's never reaches their private one)
  const me = useCloud((s) => s.user?.id ?? null)
  const owner = team ? me : undefined
  useDismissMirrorToasts()
  const recipe = useMemo(() => resolveRecipe(source.profile, source.recipe, lang), [source, lang])
  // the key property's name in every language (the UI's first): a database set up in the other language still fits
  const keys = useMemo<KeyName[]>(
    () =>
      [lang, ...LANGS.filter((l) => l !== lang)].flatMap((l) => {
        const key = (l === lang ? recipe : resolveRecipe(source.profile, source.recipe, l)).properties.find((p) => p.key)
        return key ? [{ name: key.name, lang: l }] : []
      }),
    [source, recipe, lang],
  )
  // the recipe as it builds: its problems block Create (they are listed under Workspace → Integrations)
  const built = useMemo(() => {
    let errors = 0
    // only counted here: no "did you mean" searches
    const schema = buildMirror(
      recipe,
      (i) => {
        if ((i.severity ?? 'error') === 'error') errors++
      },
      [],
      { left: 0 },
    )
    return { schema, errors }
  }, [recipe])
  // the profile's sources on this device as they are now: switched on and matching (Settings can change while it is open)
  const servers = useMemo(() => {
    const names = matchingServers(source.profile, deviceServers(settings))
    return readServers(settings).filter((s) => names.includes(s.name))
  }, [settings, source.profile])
  // the recipe's sources as far as an existing mirror goes: every server of this device that matches the profile,
  // switched on or off (a mirror whose server is off now is still that database's mirror)
  const sourceServers = useMemo(() => matchingServers(source.profile, deviceServers(settings).map((s) => ({ ...s, enabled: true }))), [source.profile, settings])
  const first = servers[0]
  // the pick is a server of this device (its id: a rename in Settings keeps it); its last known entry names it once
  // it is deleted there
  const [pickId, setPickId] = useState<string>(first?.id ?? '')
  const lastSeen = useRef<McpServerConfig | null>(first ?? null)
  // the servers listed before it when it was last seen: a deleted pick keeps its place in the list
  const seenBefore = useRef<string[]>([])
  const [name, setName] = useState(() => recipe.dbName || (first ? nameFromServer(first.name) : ''))
  const [named, setNamed] = useState(!!recipe.dbName)
  const [parentId, setParentId] = useState<ID | null>(null)
  const [tried, setTried] = useState(false)
  const [failed, setFailed] = useState('')
  const ids = { name: `${uid}-name`, where: `${uid}-where`, src: `${uid}-src` }
  const nameInput = useRef<HTMLInputElement>(null)
  const openKey = useRef<HTMLButtonElement>(null)

  const errName = tried && !name.trim() ? t('features.agents.mirror.err.name') : ''
  // what became of the picked source in Settings while the setup is open (it keeps its place in the list, marked, and
  // Create waits): switched off · no longer matching the profile (address, tools, name) · deleted
  const all = readServers(settings)
  // by its id (a rename keeps it), else by its name (deleted and set up again: agents name servers by name)
  const known = lastSeen.current
  const current = pickId ? (all.find((s) => s.id === pickId) ?? (known ? all.find((s) => s.name === known.name) : undefined) ?? null) : null
  if (current) {
    lastSeen.current = current
    seenBefore.current = all.slice(0, all.indexOf(current)).map((s) => s.id)
  }
  const picked = current ?? (pickId ? lastSeen.current : null)
  const pickedId = current?.id ?? pickId
  const server = picked?.name ?? ''
  const pick = sourceState(source.profile, picked, current, servers)
  const others = servers.filter((s) => s.id !== pickedId).length
  const pickName = server.toUpperCase()
  const errServer =
    pick.state === 'off'
      ? t('features.agents.mirror.err.serverOff', { name: pickName })
      : pick.state === 'mismatch'
        ? t(`features.agents.mirror.err.serverMiss.${pick.why}`, { name: pickName, profile: source.profile.name, missing: pick.missing.join(', ') })
        : pick.state === 'gone'
          ? t(others ? 'features.agents.mirror.err.serverGone' : 'features.agents.mirror.err.serverGoneLast', { name: pickName, profile: source.profile.name })
          : !servers.length
            ? t('features.agents.mirror.err.noServers', { profile: source.profile.name })
            : tried && pick.state !== 'ok'
              ? t('features.agents.mirror.err.server')
              : ''
  // the pick keeps its place in the list when it is off, no longer matches or was deleted
  const at = servers.filter((s) => seenBefore.current.includes(s.id)).length
  const shownServers =
    picked && pick.state !== 'ok' && pick.state !== 'none'
      ? current
        ? all.filter((s) => s.id === current.id || servers.some((x) => x.id === s.id))
        : [...servers.slice(0, at), picked, ...servers.slice(at)]
      : servers
  // switched off, no longer matching, deleted (nothing picked yet — no source when it opened — is said when Create is pressed)
  const pickBad = pick.state !== 'ok' && pick.state !== 'none'

  const pickServer = (s: McpServerConfig) => {
    setPickId(s.id)
    lastSeen.current = s
    seenBefore.current = all.slice(0, all.findIndex((x) => x.id === s.id)).map((x) => x.id)
    // the name follows the source until the person typed one (or the recipe names the database)
    if (!named) setName(nameFromServer(s.name))
  }

  const keyProp = built.schema.properties.find((p) => p.key)
  // a live database of this name: never a second one silently (one holding the recipe's key can take the agent)
  const existing = useMemo(() => sameNamedDb(pages, databases, agents, name, keys, sourceServers, team, owner), [pages, databases, agents, name, keys, sourceServers, team, owner])
  // what the name names: the database always, the agent and the report page when the recipe's names hold {db}
  const dbIn = { agent: recipe.agent.name.includes('{db}'), report: recipe.reportName.includes('{db}') }
  const nameHint = t(dbIn.agent ? (dbIn.report ? 'features.agents.mirror.nameHint' : 'features.agents.mirror.nameHintAgent') : dbIn.report ? 'features.agents.mirror.nameHintReport' : 'features.agents.mirror.nameHintDb')
  // "Use" is offered: the recipe as reuseMirror resolves it — in the language the database's key is named in
  const usable = !!existing && existing.fits && !existing.shared && !existing.agent && !existing.trashed
  const recipeFor = (x: SameNamed) => {
    const l = x.lang ?? recipe.lang
    return l === recipe.lang ? recipe : resolveRecipe(source.profile, source.recipe, l)
  }
  const shownName = name.replace(/\s+/g, ' ').trim()
  // the names on the plate exactly as the offered action makes them — "Use" (the page it takes back, or the new one's
  // title) or Create: one function for the plate, createMirror and reuseMirror (mirrorTitles)
  const titles =
    usable && existing
      ? mirrorTitles({ recipe: recipeFor(existing), server, name: existing.title, dbId: existing.id, reuse: true }, { pages, agents, team })
      : mirrorTitles({ recipe, server, name: shownName || t('features.agents.mirror.namePh'), dbId: null }, { pages, agents, team })

  const run = (make: () => MirrorMade) => {
    setTried(true)
    setFailed('')
    if (!servers.some((s) => s.name === server)) return
    try {
      onCreated(make())
    } catch (e) {
      setFailed(t('features.agents.mirror.err.failed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }
  const create = () => {
    if (!name.trim() || existing || built.errors) return setTried(true)
    run(() => createMirror({ recipe, server, name, parentId }))
  }
  const takeExisting = () => {
    if (!usable || !existing) return
    // the agent's names and instructions in the language the database's properties are named in
    run(() => reuseMirror({ recipe: recipeFor(existing), server, dbId: existing.id }))
  }
  // in the trash with an agent marked for it: restore it (the page in the trash that holds it) — the notice then offers
  // that agent, and focus goes to its key (else the name field; never the page body: the Restore key is gone)
  const restore = (root: ID) => {
    useWorkspace.getState().restorePage(root)
    requestAnimationFrame(() => (openKey.current ?? nameInput.current)?.focus())
  }
  // a saved agent mirrors into it already: that one, never a second
  const openAgent = (id: ID) => {
    onClose()
    navigate(`#/agents/${id}`)
  }
  // a team's shared database first: the mirror never uses it, whoever's agent writes into it (never "Open" a teammate's)
  const existsText = !existing
    ? ''
    : existing.shared
      ? t('features.agents.mirror.exists.shared', { name: existing.title })
      : existing.trashed && existing.agent
        ? existing.trashed.parent
          ? t('features.agents.mirror.exists.trashedBelow', { name: existing.title, parent: existing.trashed.parent, agent: existing.agent.name })
          : t('features.agents.mirror.exists.trashed', { name: existing.title, agent: existing.agent.name })
        : existing.agent
        ? t('features.agents.mirror.exists.mirrored', { name: existing.title, agent: existing.agent.name })
        : t(existing.fits ? 'features.agents.mirror.exists.fits' : 'features.agents.mirror.exists.other', { name: existing.title })

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
  // only "Open …" (and Restore) is offered: the plate shows what is there — that agent, its report page and its
  // database — never names no offered action makes
  const there = existing && !existing.shared && existing.agent ? (agents?.[existing.agent.id] ?? null) : null
  const thereDb = there && existing ? databases[existing.id] : undefined
  const thereReport = there?.output?.pageId ? pages[there.output.pageId] : undefined
  const plate = there
    ? {
        db: t('features.agents.mirror.spec.dbValue', { props: thereDb?.properties.length ?? 0, views: thereDb?.views.length ?? 0, key: thereDb?.properties.find((p) => p.key)?.name ?? '—' }),
        yours: (thereDb?.properties ?? []).filter((p) => p.agentReadOnly).map((p) => p.name).join(' · '),
        agent: there.name,
        agentValue: t('features.agents.mirror.spec.agentValue', { when: triggerText(t, there.trigger, { pages, databases, lang }), mode: t(`features.agents.mirror.spec.${there.write}`), usd: fmtUsd(there.maxRunUsd, lang) }),
        report: thereReport ? thereReport.title.trim() || t('common.untitled') : '—',
      }
    : {
        db: t('features.agents.mirror.spec.dbValue', { props: built.schema.properties.length, views: built.schema.views.length, key: keyProp?.name ?? '—' }),
        yours,
        agent: titles.agentName,
        agentValue: t('features.agents.mirror.spec.agentValue', { when, mode: t(recipe.agent.write === 'apply' ? 'features.agents.mirror.spec.apply' : 'features.agents.mirror.spec.stage'), usd: fmtUsd(recipe.agent.budget, lang) }),
        report: titles.reportTitle,
      }

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
          <button type="button" className="btn btn--primary" onClick={create} disabled={!servers.length || built.errors > 0 || !!existing || pickBad}>
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
            {shownServers.map((s) => {
              const tools = s.tools ?? []
              // the pick that was switched off, no longer matches or was deleted: marked, never picked again from here
              const off = s.id === pickedId && pickBad
              const state = off
                ? t(pick.state === 'gone' ? 'features.agents.mirror.serverGone' : pick.state === 'mismatch' ? 'features.agents.mirror.serverMiss' : 'features.agents.mirror.serverOff')
                : tools.length
                  ? t('features.agents.mirror.tools', { n: tools.length, read: tools.filter(isReadTool).length })
                  : t('features.agents.mirror.untested')
              return (
                <label key={s.id} className="agx-mir__server" data-untested={(!off && !tools.length) || undefined} data-off={off || undefined} data-state={off ? pick.state : undefined}>
                  <input type="radio" name={`${uid}-server`} value={s.name} checked={s.id === pickedId} disabled={off} onChange={() => pickServer(s)} aria-describedby={off && errServer ? `${ids.src}-err` : undefined} />
                  <span className="agx-mir__srvname mono">{s.name.toUpperCase()}</span>
                  <span className="agx-mir__srvstate">{state}</span>
                </label>
              )
            })}
          </div>
          <p className="agx-field__hint">{t('features.agents.mirror.sourceHintProfile', { profile: source.profile.name })}</p>
          {errServer && (
            <p className="agx-field__error" id={`${ids.src}-err`} role="alert" data-testid="agx-mir-server-err">
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
              ref={nameInput}
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
                {nameHint}
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
        {existing && (
          <div className="agx-notice agx-mir__exists" role="status" data-testid="agx-mir-exists">
            <span className="led led--on" aria-hidden />
            <span>{existsText}</span>
            {existing.shared ? null : existing.agent ? (
              <span className="agx-mir__keys">
                {existing.trashed && (
                  <button type="button" className="btn btn--sm" onClick={() => existing.trashed && restore(existing.trashed.root)}>
                    {existing.trashed.parent ? t('features.agents.mirror.exists.restoreParent', { parent: existing.trashed.parent }) : t('features.agents.mirror.exists.restore')}
                  </button>
                )}
                <button type="button" ref={openKey} className="btn btn--sm btn--ink" onClick={() => existing.agent && openAgent(existing.agent.id)}>
                  {t('features.agents.mirror.exists.open', { agent: existing.agent.name })}
                </button>
              </span>
            ) : (
              existing.fits && (
                <button type="button" className="btn btn--sm btn--ink" onClick={takeExisting} disabled={pickBad}>
                  {t('features.agents.mirror.exists.use', { name: existing.title })}
                </button>
              )
            )}
          </div>
        )}

        <dl className="agx-spec agx-mir__spec" data-testid="agx-mir-spec" data-there={there ? '' : undefined}>
          <div>
            <dt>{t('features.agents.mirror.spec.db')}</dt>
            <dd>{plate.db}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.yours')}</dt>
            <dd>{plate.yours || '—'}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.agent')}</dt>
            <dd>
              <span className="agx-mir__agentname" data-testid="agx-mir-agent">
                {plate.agent}
              </span>
              <span>{plate.agentValue}</span>
            </dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.report')}</dt>
            <dd data-testid="agx-mir-report">{plate.report}</dd>
          </div>
        </dl>
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
