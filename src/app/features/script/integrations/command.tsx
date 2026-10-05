/**
 * Database command kind "script" — "Run script" (registered with the commands area's
 * registerCommandKind at boot). Started from the database page's toolbar with rows selected, the script
 * runs once per selected row (page.current = that row); otherwise once for the database page itself.
 * The run is a normal run: the effects are asked first, every change can be undone (the script's run
 * log; a single run's toast has Undo).
 */
import { SquareCode } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { PageIcon } from '../../../ui/PageIcon'
import { t, useT } from '../../../i18n'
import { CommandFailure, FieldPicker, type CommandKindDef, type CommandPickerProps } from '../../commands'
import { runScriptById } from '../runtime/active'
import { errorMessage } from '../ui/errors'
import { openScripts } from '../actions'

export interface ScriptCommandConfig {
  scriptId: ID | null
}

const SAFE = /^[\w-]{1,64}$/

function ScriptPicker({ config, onChange }: CommandPickerProps<ScriptCommandConfig>) {
  const t = useT()
  const scripts = useWorkspace(useShallow((s) => Object.values(s.scripts ?? {}).filter((x) => x.kind === 'script').sort((a, b) => a.name.localeCompare(b.name))))
  const cur = scripts.find((s) => s.id === config.scriptId)
  if (!scripts.length)
    return (
      <p className="dbc-note">
        {t('features.script.int.cmd.empty')}{' '}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => openScripts()}>
          {t('features.script.int.cmd.openScripts')}
        </button>
      </p>
    )
  const glyph = (icon: (typeof scripts)[number]['icon']) => (icon ? <PageIcon icon={icon} size={15} /> : <SquareCode size={15} strokeWidth={1.7} aria-hidden />)
  return (
    <>
      <FieldPicker
        label={t('features.script.int.cmd.pick')}
        placeholder={t('features.script.int.cmd.placeholder')}
        searchable={scripts.length > 6}
        searchPlaceholder={t('features.script.int.cmd.search')}
        value={
          cur ? (
            <>
              {glyph(cur.icon)} {cur.name}
            </>
          ) : config.scriptId ? (
            <span className="faint">{t('features.script.int.cmd.gone')}</span>
          ) : null
        }
        entries={scripts.map((s) => ({ label: s.name, icon: glyph(s.icon), checked: s.id === config.scriptId, onSelect: () => onChange((c) => ({ ...c, scriptId: s.id })) }))}
      />
      <p className="dbc-note">{t('features.script.int.cmd.hint')}</p>
    </>
  )
}

export const scriptCommandKind: CommandKindDef<ScriptCommandConfig> = {
  kind: 'script',
  label: () => t('features.script.int.cmd.kind'),
  icon: SquareCode,
  Picker: ScriptPicker,
  create: () => ({ scriptId: null }),
  sanitize: (raw) => {
    const id = raw && typeof raw === 'object' ? (raw as { scriptId?: unknown }).scriptId : null
    return { scriptId: typeof id === 'string' && SAFE.test(id) ? id : null }
  },
  writes: true,
  unavailable: ({ config }) => {
    if (!config.scriptId) return t('features.script.int.cmd.none')
    return useWorkspace.getState().scripts?.[config.scriptId] ? null : t('features.script.int.cmd.gone')
  },
  run: async ({ databaseId, config, rowIds }) => {
    const script = config.scriptId ? useWorkspace.getState().scripts?.[config.scriptId] : undefined
    if (!script) throw new CommandFailure(t('features.script.int.cmd.goneErr'), null)
    const targets = rowIds.length ? rowIds : [databaseId]
    // one target: the run's own toast (changes with Undo, or the error)
    if (targets.length === 1) {
      const r = await runScriptById(script.id, { contextPageId: targets[0] })
      if (!r) throw new CommandFailure(t('features.script.int.busy', { name: script.name }), null)
      return null
    }
    let done = 0
    let changes = 0
    for (const id of targets) {
      const r = await runScriptById(script.id, { contextPageId: id, notify: false })
      if (!r) throw new CommandFailure(t('features.script.int.busy', { name: script.name }), null)
      if (r.status === 'cancelled' || r.status === 'stopped') break
      if (r.status === 'error' && r.error) throw new CommandFailure(t('features.script.failedToast', { name: script.name, message: errorMessage(r.error, t) }), null)
      done++
      changes += r.changes.filter((c) => !c.skipped).length
    }
    return t(done === 1 ? 'features.script.int.cmd.ranRows.one' : 'features.script.int.cmd.ranRows.other', { name: script.name, n: done, changes })
  },
}
