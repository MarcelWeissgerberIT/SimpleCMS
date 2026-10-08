/**
 * Custom agents — the first step of the recipe "Mirror a list into a database": the source (one of the person's MCP
 * servers, its tool count from the last connection test), a name and the page it goes below (team workspace: a
 * private page, or the Private section's top). "Create" makes the database and its report page (mirror.ts — one
 * toast, one Undo) and hands the agent draft to the editor.
 */
import { useId, useMemo, useState } from 'react'
import { ChevronDown, KeyRound } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import { readServers } from '../ai/mcp-servers/config'
import { isReadTool } from './mcpTools'
import { HAND_ROLES, MIRROR_AT, MIRROR_BUDGET_USD, MIRROR_PROPS, canHoldMirror, createMirror, nameFromServer, propName, type MirrorMade } from './mirror'
import { fmtUsd } from './format'
import './agents.css'
import './mirror.css'

/** The number of views a mirror database gets (mirror.ts mirrorSchema). */
const VIEW_COUNT = 6

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

export function MirrorSetup({ onClose, onCreated, onUndo }: { onClose: () => void; onCreated: (made: MirrorMade) => void; onUndo: () => void }) {
  const t = useT()
  const uid = useId()
  const settings = useWorkspace((s) => s.settings)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const servers = useMemo(() => readServers(settings), [settings])
  const first = servers.find((s) => s.enabled) ?? servers[0]
  const [server, setServer] = useState<string>(first?.name ?? '')
  const [name, setName] = useState(() => (first ? nameFromServer(first.name) : ''))
  const [named, setNamed] = useState(false)
  const [parentId, setParentId] = useState<ID | null>(null)
  const [tried, setTried] = useState(false)
  const [failed, setFailed] = useState('')
  const ids = { name: `${uid}-name`, where: `${uid}-where`, src: `${uid}-src` }

  const errName = tried && !name.trim() ? t('features.agents.mirror.err.name') : ''
  const errServer = tried && !servers.some((s) => s.name === server) ? t('features.agents.mirror.err.server') : ''

  const pickServer = (n: string) => {
    setServer(n)
    // the name follows the source until the person typed one
    if (!named) setName(nameFromServer(n))
  }

  const create = () => {
    setTried(true)
    setFailed('')
    if (!name.trim() || !servers.some((s) => s.name === server)) return
    try {
      onCreated(createMirror({ server, name, parentId }, { onUndo }))
    } catch (e) {
      setFailed(t('features.agents.mirror.err.failed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  const keyName = propName('key')
  const yours = HAND_ROLES.map(propName).join(' · ')
  const openSettings = () => useUI.getState().openModal({ type: 'settings', tab: 'ai' })

  return (
    <Modal
      open
      onClose={onClose}
      label="§ AG-S"
      title={t('features.agents.mirror.title')}
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
          <button type="button" className="btn btn--primary" onClick={create} disabled={!servers.length}>
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
        <p className="agx-lead agx-lead--modal">{t('features.agents.mirror.lead', { yours })}</p>

        <div className="agx-field" data-invalid={errServer ? '' : undefined}>
          <span className="agx-field__label" id={ids.src}>
            <span className="agx-mir__n label">01</span> {t('features.agents.mirror.source')}
          </span>
          {servers.length === 0 ? (
            <p className="agx-notice agx-mir__none" role="note">
              <span className="led" aria-hidden />
              <span>{t('features.agents.mirror.noServers')}</span>
              <button type="button" className="btn btn--sm btn--ink" onClick={openSettings}>
                <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agents.mirror.addServer')}
              </button>
            </p>
          ) : (
            <div className="agx-mir__servers" role="radiogroup" aria-labelledby={ids.src}>
              {servers.map((s) => {
                const tools = s.tools ?? []
                const state = !s.enabled ? t('features.agents.mirror.off') : tools.length ? t('features.agents.mirror.tools', { n: tools.length, read: tools.filter(isReadTool).length }) : t('features.agents.mirror.untested')
                return (
                  <label key={s.id} className="agx-mir__server" data-untested={(s.enabled && !tools.length) || undefined} data-off={!s.enabled || undefined}>
                    <input type="radio" name={`${uid}-server`} value={s.name} checked={server === s.name} onChange={() => pickServer(s.name)} />
                    <span className="agx-mir__srvname mono">{s.name.toUpperCase()}</span>
                    <span className="agx-mir__srvstate">{state}</span>
                  </label>
                )
              })}
            </div>
          )}
          {servers.length > 0 && (
            <p className="agx-field__hint">
              {t('features.agents.mirror.sourceHint')}{' '}
              {servers.some((s) => s.name === server && !s.tools?.length) && (
                <button type="button" className="agx-link" onClick={openSettings}>
                  {t('features.agents.ed.toolsTest')}
                </button>
              )}
            </p>
          )}
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
            <dd>{t('features.agents.mirror.spec.dbValue', { props: MIRROR_PROPS.length, views: VIEW_COUNT, key: keyName })}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.yours')}</dt>
            <dd>{yours}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.agent')}</dt>
            <dd>{t('features.agents.mirror.spec.agentValue', { at: MIRROR_AT, usd: fmtUsd(MIRROR_BUDGET_USD) })}</dd>
          </div>
          <div>
            <dt>{t('features.agents.mirror.spec.report')}</dt>
            <dd>{t('features.agents.mirror.reportTitle', { name: name.trim() || t('features.agents.mirror.namePh') })}</dd>
          </div>
        </dl>
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
