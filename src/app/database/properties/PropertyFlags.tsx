/**
 * The property menu's two switches for agents (store/keys.ts): "Key" (text / number / url — unique per row, what
 * agents' upsert_rows find rows by) and "Only by hand" (agents never write it). A refusal (rows share a value) shows
 * here, at the switch. Not on a locked database (the schema is fixed) — the menu's head says it is locked.
 *
 * Each switch shows only while an active integration profile unlocks it (features: useUnlocked 'keys' / 'onlyByHand').
 * Without one, a key the property already has is shown as a read-only mark — and still ENFORCED everywhere: data
 * integrity never depends on the gate. "Only by hand" is a safety flag (the Patchbay's key 2 sets it without the unlock,
 * plan §1.9 / Q1): while it is set the switch shows to everyone, so it can always be switched off where it is shown;
 * switching it ON stays gated (without the unlock, a switch shown in this menu that was switched off stays, disabled).
 */
import { useRef, useState, type ReactNode } from 'react'
import { Hand, KeyRound } from 'lucide-react'
import type { Database, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { canBeHandOnly, canBeKey } from '../../store/keys'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { useUnlocked } from '../../features'
import { setHandOnly, setKeyProperty } from '../model/keys'

/** A flag the property has while its switch is not offered here: a mark, not a control. */
function FlagMark({ icon, label, hint, testId }: { icon: ReactNode; label: string; hint: string; testId: string }) {
  const t = useT()
  return (
    <div className="db-cfg__row db-flags__row db-flags__row--mark" data-testid={testId} title={hint}>
      <span className="db-flags__name">
        {icon}
        {label}
        <span className="label db-flags__hint">{hint}</span>
      </span>
      <span className="label db-flags__on">
        <span className="led led--ok" aria-hidden />
        {t('database.flag.set')}
      </span>
    </div>
  )
}

export function PropertyFlags({ db, prop }: { db: Database; prop: PropertyDef }) {
  const t = useT()
  const live = useWorkspace((s) => s.databases[db.id]?.properties.find((p) => p.id === prop.id)) ?? prop
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const keysOn = useUnlocked('keys')
  const handOn = useUnlocked('onlyByHand')
  const keyable = canBeKey(live)
  const handable = canBeHandOnly(live)
  // a switch only where a profile unlocks it; a flag that is set shows as a mark otherwise
  const keySwitch = keyable && keysOn
  // a set hand-only flag always shows its switch (off is always allowed); once shown in this menu it stays — disabled
  // while off without the unlock (switching on stays gated)
  const handShown = useRef(false)
  if (handable && (handOn || live.agentReadOnly === true)) handShown.current = true
  const handSwitch = handable && handShown.current
  const handLocked = !handOn && live.agentReadOnly !== true
  const keyMark = !keySwitch && live.key === true
  const handMark = !handSwitch && live.agentReadOnly === true
  if (!keySwitch && !handSwitch && !keyMark && !handMark) return null
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
      {keySwitch && (
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
      {keyMark && <FlagMark icon={<KeyRound size={14} strokeWidth={1.75} aria-hidden />} label={t('database.key.menu')} hint={t('database.key.menuHint')} testId="db-flag-key-mark" />}
      {handSwitch && (
        <label className="db-cfg__row db-cfg__row--switch db-flags__row">
          <span className="db-flags__name">
            <Hand size={14} strokeWidth={1.75} aria-hidden />
            {t('database.hand.menu')}
            <span className="label db-flags__hint" id={handId}>
              {t('database.hand.menuHint')}
            </span>
          </span>
          <Switch size="sm" seed={`hand-${live.id}`} checked={live.agentReadOnly === true} label={t('database.hand.menu')} describedBy={handId} onChange={toggleHand} disabled={handLocked} />
        </label>
      )}
      {handMark && <FlagMark icon={<Hand size={14} strokeWidth={1.75} aria-hidden />} label={t('database.hand.menu')} hint={t('database.hand.menuHint')} testId="db-flag-hand-mark" />}
      {(keyMark || handMark) && <p className="db-flags__note db-flags__note--mark">{t('database.flag.gated')}</p>}
      {handSwitch && handLocked && <p className="db-flags__note db-flags__note--mark">{t('database.hand.gatedOn')}</p>}
      {note && (
        <p className="db-flags__note" data-error={note.error || undefined} role={note.error ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
    </div>
  )
}
