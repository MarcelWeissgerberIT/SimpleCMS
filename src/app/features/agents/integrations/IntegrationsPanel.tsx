/**
 * Workspace → Integrations: the integration profiles (Workspace.integrations) — each with its LED and why (active:
 * "matches <server>"; inactive: the closest miss), what it unlocks, its recipes; New (the generic template, or from
 * one of this device's servers), Import (paste or a .json file), Export (.json), Edit (the JSON editor with live
 * validation), Delete with Undo. Team workspaces: owners and admins edit, members read and export.
 * Below: what is unlocked on THIS device (it depends on this device's MCP servers).
 */
import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, FileUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { exportIntegration, localized, unlockedBy } from '../../../store/integrations'
import { INTEGRATION_FEATURES, type IntegrationProfile } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { Led } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { readServers } from '../../ai/mcp-servers/config'
import { deviceServers, useIntegrationStatuses } from './status'
import { stringify } from './json'
import { integrationTemplate } from './template'
import { IntegrationEditor, type EditorMode } from './IntegrationEditor'
import { featureList, statusText } from './text'
import './integrations.css'

/** May this member change the profiles here? Local: yes · team: owners and admins (members read). */
export function useCanEditIntegrations(): boolean {
  return useCloud((s) => s.active.kind !== 'cloud' || (!s.readOnly && (s.role === 'owner' || s.role === 'admin')))
}

function download(profile: IntegrationProfile) {
  const blob = new Blob([`${stringify(exportIntegration(profile))}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${profile.id}.integration.json`
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function IntegrationsPanel() {
  const t = useT()
  const lang = useLang()
  const states = useIntegrationStatuses()
  const canEdit = useCanEditIntegrations()
  const settings = useWorkspace((s) => s.settings)
  const profiles = useWorkspace((s) => s.integrations)
  const menu = useMenu()
  const [editing, setEditing] = useState<{ mode: EditorMode; text: string; id?: string; n: number } | null>(null)
  const seq = useRef(0)
  const unlockedHere = useMemo(() => unlockedBy(profiles, deviceServers(settings)), [profiles, settings])
  const taken = (profiles ?? []).map((p) => p.id)

  const open = (mode: EditorMode, text: string, id?: string) => setEditing({ mode, text, id, n: ++seq.current })
  const fromTemplate = (server?: { name: string; tools?: string[] }) => open('new', stringify(integrationTemplate(lang, taken, server ?? null)))
  const servers = readServers(settings).filter((s) => s.enabled)
  const entries: MenuEntry[] = [
    { label: t('features.integrations.newTemplate'), onSelect: () => fromTemplate() },
    ...(servers.length ? [{ kind: 'section' as const, label: t('features.integrations.newFromServer') }] : []),
    ...servers.map((s) => ({
      label: s.name.toUpperCase(),
      hint: s.tools?.length ? t('features.integrations.toolsN', { n: s.tools.length }) : t('features.integrations.untested'),
      onSelect: () => fromTemplate({ name: s.name, tools: s.tools }),
    })),
  ]

  const remove = (p: IntegrationProfile) => {
    if (!useWorkspace.getState().deleteIntegration(p.id)) return
    useUI.getState().toast({
      message: t('features.integrations.deleted', { name: p.name }),
      action: { label: t('common.undo'), run: () => void useWorkspace.getState().upsertIntegration(p) },
    })
  }

  return (
    <div className="int" data-testid="ws-integrations">
      <div className="int-bar">
        {canEdit ? (
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} data-testid="int-new">
              <Plus size={14} strokeWidth={1.9} aria-hidden /> {t('features.integrations.new')}
              <ChevronDown size={13} aria-hidden />
            </button>
            <Menu {...menu.props} entries={entries} width={300} />
            <button type="button" className="btn btn--sm" onClick={() => open('import', '')} data-testid="int-import">
              <FileUp size={14} strokeWidth={1.75} aria-hidden /> {t('features.integrations.import')}
            </button>
          </>
        ) : (
          <p className="int-note" data-testid="int-readonly">
            <Led state="off" /> {t('features.integrations.membersRead')}
          </p>
        )}
      </div>

      <div className="int-sub">
        <h3 className="label int-sub__label">{t('features.integrations.profiles')}</h3>
        <span className="int-sub__rule" aria-hidden />
        <span className="int-sub__count">{String(states.length).padStart(2, '0')}</span>
      </div>
      {states.length === 0 ? (
        <div className="int-empty" data-testid="int-empty">
          <p>{t('features.integrations.empty')}</p>
          <p className="int-empty__what">{featureList(t, INTEGRATION_FEATURES)}</p>
        </div>
      ) : (
        <ul className="int-list">
          {states.map(({ profile: p, status }, i) => (
            <li key={p.id} className="int-row" data-active={status.active || undefined} data-testid="int-row" data-id={p.id}>
              <div className="int-row__head">
                <span className="int-row__n label">IN-{String(i + 1).padStart(2, '0')}</span>
                <Led state={status.active ? 'ok' : 'off'} />
                <span className="int-row__name">{p.name}</span>
                <span className="int-row__id mono">{p.id}</span>
                <span className="int-row__keys">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => open(canEdit ? 'edit' : 'view', stringify(exportIntegration(p)), p.id)} aria-label={`${t(canEdit ? 'features.integrations.edit' : 'features.integrations.view')}: ${p.name}`}>
                    <Pencil size={13} strokeWidth={1.75} aria-hidden /> {t(canEdit ? 'features.integrations.edit' : 'features.integrations.view')}
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => download(p)} aria-label={`${t('features.integrations.export')}: ${p.name}`}>
                    <Download size={13} strokeWidth={1.75} aria-hidden /> {t('features.integrations.export')}
                  </button>
                  {canEdit && (
                    <button type="button" className="btn btn--sm btn--ghost int-row__del" onClick={() => remove(p)} aria-label={`${t('features.integrations.delete')}: ${p.name}`}>
                      <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                    </button>
                  )}
                </span>
              </div>
              {p.description && <p className="int-row__desc">{p.description}</p>}
              <dl className="int-row__spec">
                <div>
                  <dt>{t('features.integrations.spec.status')}</dt>
                  <dd data-testid="int-status">{statusText(t, status)}</dd>
                </div>
                <div>
                  <dt>{t('features.integrations.spec.unlocks')}</dt>
                  <dd>{p.unlocks.length ? featureList(t, p.unlocks) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('features.integrations.spec.recipes')}</dt>
                  <dd>{p.recipes?.length ? p.recipes.map((r) => localized(r.name, lang) || t('features.agents.recipe.mirror.name')).join(' · ') : '—'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <div className="int-sub">
        <h3 className="label int-sub__label">{t('features.integrations.here')}</h3>
        <span className="int-sub__rule" aria-hidden />
        <span className="int-sub__count">
          {unlockedHere.size}/{INTEGRATION_FEATURES.length}
        </span>
      </div>
      <ul className="int-feats" data-testid="int-unlocked">
        {INTEGRATION_FEATURES.map((f) => (
          <li key={f} className="int-feat" data-on={unlockedHere.has(f) || undefined}>
            <Led state={unlockedHere.has(f) ? 'ok' : 'off'} />
            <span className="int-feat__name">{t(`features.integrations.feature.${f}`)}</span>
            <span className="int-feat__what">{t(`features.integrations.featureWhat.${f}`)}</span>
          </li>
        ))}
      </ul>
      <p className="int-foot">{t('features.integrations.hereHint')}</p>

      {editing && <IntegrationEditor key={editing.n} mode={editing.mode} initial={editing.text} originalId={editing.id} onClose={() => setEditing(null)} />}
    </div>
  )
}
