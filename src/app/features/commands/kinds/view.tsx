/** Kind "view": open the database on one of its views (its page; switched in place when it is open). */
import { Table2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { useT, t } from '../../../i18n'
import { openDatabaseView } from '../../../database'
import { CommandFailure } from '../failure'
import { FieldPicker } from '../parts'
import type { CommandKindDef, CommandPickerProps } from '../types'

export interface ViewConfig {
  viewId: string | null
}

const SAFE = /^[\w-]{1,64}$/
const NONE: never[] = []

function ViewPicker({ databaseId, config, onChange }: CommandPickerProps<ViewConfig>) {
  const t = useT()
  const views = useWorkspace((s) => s.databases[databaseId]?.views ?? NONE)
  const cur = views.find((v) => v.id === config.viewId)
  const name = (v: (typeof views)[number]) => v.name.trim() || t(`database.view.${v.type}`)
  return (
    <FieldPicker
      label={t('features.cmd.view.pick')}
      placeholder={t('features.cmd.view.placeholder')}
      value={cur ? name(cur) : config.viewId ? <span className="faint">{t('features.cmd.view.gone')}</span> : null}
      entries={views.map((v) => ({ label: name(v), hint: t(`database.view.${v.type}`).toUpperCase(), checked: v.id === config.viewId, onSelect: () => onChange((c) => ({ ...c, viewId: v.id })) }))}
    />
  )
}

export const viewKind: CommandKindDef<ViewConfig> = {
  kind: 'view',
  label: () => t('features.cmd.kind.view'),
  icon: Table2,
  Picker: ViewPicker,
  create: (dbId) => ({ viewId: useWorkspace.getState().databases[dbId]?.views[0]?.id ?? null }),
  sanitize: (raw) => {
    const id = raw && typeof raw === 'object' ? (raw as { viewId?: unknown }).viewId : null
    return { viewId: typeof id === 'string' && SAFE.test(id) ? id : null }
  },
  writes: false,
  unavailable: ({ databaseId, config }) => {
    if (!config.viewId) return t('features.cmd.view.none')
    return useWorkspace.getState().databases[databaseId]?.views.some((v) => v.id === config.viewId) ? null : t('features.cmd.view.gone')
  },
  run: ({ databaseId, config }) => {
    const ui = useUI.getState()
    if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
    if (!config.viewId || !openDatabaseView(databaseId, config.viewId)) throw new CommandFailure(t('features.cmd.err.viewGone'), null)
  },
}
