/**
 * The property menu's two switches for agents (store/keys.ts): "Key" (text / number / url — unique per row, what
 * agents' upsert_rows find rows by) and "Only by hand" (agents never write it). A refusal (rows share a value) shows
 * here, at the switch. Not on a locked database (the schema is fixed) — the menu's head says it is locked.
 */
import { useState } from 'react'
import { Hand, KeyRound } from 'lucide-react'
import type { Database, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { canBeHandOnly, canBeKey } from '../../store/keys'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { setHandOnly, setKeyProperty } from '../model/keys'

export function PropertyFlags({ db, prop }: { db: Database; prop: PropertyDef }) {
  const t = useT()
  const live = useWorkspace((s) => s.databases[db.id]?.properties.find((p) => p.id === prop.id)) ?? prop
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const keyable = canBeKey(live)
  const handable = canBeHandOnly(live)
  if (!keyable && !handable) return null
  const keyId = `db-flag-key-${live.id}`
  const handId = `db-flag-hand-${live.id}`

  const toggleKey = (on: boolean) => {
    const res = setKeyProperty(db.id, live.id, on)
    if (res.ok) setNote({ text: t(on ? 'database.key.on' : 'database.key.off', { name: live.name }), error: false })
    else setNote({ text: t(`database.key.refused.${res.reason}`, { name: live.name, value: res.value ?? '', count: res.count ?? 0 }), error: true })
  }
  const toggleHand = (on: boolean) => {
    if (setHandOnly(db.id, live.id, on)) setNote({ text: t(on ? 'database.hand.on' : 'database.hand.off', { name: live.name }), error: false })
    else setNote({ text: t('database.key.refused.locked'), error: true })
  }

  return (
    <div className="db-cfg db-flags">
      {keyable && (
        <label className="db-cfg__row db-cfg__row--switch db-flags__row">
          <span className="db-flags__name">
            <KeyRound size={14} strokeWidth={1.75} aria-hidden />
            {t('database.key.menu')}
            <span className="label db-flags__hint" id={keyId}>
              {t('database.key.menuHint')}
            </span>
          </span>
          <Switch size="sm" seed={`key-${live.id}`} checked={live.key === true} label={t('database.key.menu')} describedBy={keyId} onChange={toggleKey} />
        </label>
      )}
      {handable && (
        <label className="db-cfg__row db-cfg__row--switch db-flags__row">
          <span className="db-flags__name">
            <Hand size={14} strokeWidth={1.75} aria-hidden />
            {t('database.hand.menu')}
            <span className="label db-flags__hint" id={handId}>
              {t('database.hand.menuHint')}
            </span>
          </span>
          <Switch size="sm" seed={`hand-${live.id}`} checked={live.agentReadOnly === true} label={t('database.hand.menu')} describedBy={handId} onChange={toggleHand} />
        </label>
      )}
      {note && (
        <p className="db-flags__note" data-error={note.error || undefined} role={note.error ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
    </div>
  )
}
