/**
 * Settings panels for sub-items and dependencies (opened from the toolbar "…" menu and the view
 * tab menu), the per-view sub-items display switch, and the "turn off?" dialog.
 */
import { useEffect, useId } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import type { ID, SubItemsDisplay } from '../../store/types'
import { Popover } from '../../ui/Popover'
import { Modal } from '../../ui/Modal'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { Segmented } from '../parts'
import type { DbModel } from '../hooks'
import { dependenciesOf, subItemsOf } from '../model/hierarchy'
import { disableDependencies, disableSubItems, enableDependencies, enableSubItems, setConflictMode } from '../model/structure'
import '../structure.css'

type Kind = 'sub' | 'dep'

/** Pending "turn off?" question; the host lives in DatabaseView so it outlives the panel. */
const useTurnOff = create<{ ask: { kind: Kind; dbId: ID } | null; set: (ask: { kind: Kind; dbId: ID } | null) => void; hosts: string[] }>()((set) => ({
  ask: null,
  set: (ask) => set({ ask }),
  hosts: [],
}))

function PanelHead({ title, on }: { title: string; on: boolean }) {
  const t = useT()
  return (
    <div className="db-panel__head">
      <span className={`led${on ? ' led--on' : ''}`} aria-hidden />
      <span className="label">{title}</span>
      <span style={{ flex: 1 }} />
      <span className="label db-struct__state">{on ? t('database.struct.on') : t('database.struct.off')}</span>
    </div>
  )
}

/** Per-view: nested | flattened | parents only. */
export function SubItemsDisplayRow({ m }: { m: DbModel }) {
  const t = useT()
  const value: SubItemsDisplay = m.view.subItems ?? 'nested'
  return (
    <div className="db-cfg__row db-struct__row">
      <span className="label">{t('database.sub.display')}</span>
      <Segmented
        value={value}
        ariaLabel={t('database.sub.display')}
        items={(['nested', 'flattened', 'parents'] as const).map((v) => ({ value: v, label: t(`database.sub.display.${v}`) }))}
        onChange={(v) => useWorkspace.getState().updateView(m.db.id, m.view.id, { subItems: v })}
      />
    </div>
  )
}

export function SubItemsPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const pair = subItemsOf(m.db)
  const nestable = m.view.type === 'table' || m.view.type === 'list'
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel db-struct" resizable="db-sub" aria-label={t('database.sub.title')}>
      <PanelHead title={t('database.sub.title')} on={!!pair} />
      <label className="db-cfg__row db-cfg__row--switch">
        <span>{t('database.sub.switch')}</span>
        <Switch
          size="sm"
          seed="subItems"
          checked={!!pair}
          label={t('database.sub.switch')}
          onChange={(on) => {
            if (on) enableSubItems(m.db.id)
            else {
              onClose()
              useTurnOff.getState().set({ kind: 'sub', dbId: m.db.id })
            }
          }}
        />
      </label>
      {pair ? (
        <>
          <div className="db-struct__pair">
            <span className="db-struct__prop">{pair.parent.name}</span>
            <span className="db-struct__link" aria-hidden>
              ⇄
            </span>
            <span className="db-struct__prop">{pair.children.name}</span>
          </div>
          <SubItemsDisplayRow m={m} />
          {nestable && m.groups && (m.view.subItems ?? 'nested') === 'nested' && <p className="db-struct__note">{t('database.sub.groupedFlat')}</p>}
          {!nestable && (m.view.subItems ?? 'nested') === 'nested' && <p className="db-struct__note">{t('database.sub.cardsFlat')}</p>}
        </>
      ) : (
        <p className="db-struct__note">{t('database.sub.hint')}</p>
      )}
    </Popover>
  )
}

export function DependenciesPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const pair = dependenciesOf(m.db)
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel db-struct" resizable="db-dep" aria-label={t('database.dep.title')}>
      <PanelHead title={t('database.dep.title')} on={!!pair} />
      <label className="db-cfg__row db-cfg__row--switch">
        <span>{t('database.dep.switch')}</span>
        <Switch
          size="sm"
          seed="dependencies"
          checked={!!pair}
          label={t('database.dep.switch')}
          onChange={(on) => {
            if (on) enableDependencies(m.db.id)
            else {
              onClose()
              useTurnOff.getState().set({ kind: 'dep', dbId: m.db.id })
            }
          }}
        />
      </label>
      {pair ? (
        <>
          <div className="db-struct__pair">
            <span className="db-struct__prop">{pair.blockedBy.name}</span>
            <span className="db-struct__link" aria-hidden>
              ⇄
            </span>
            <span className="db-struct__prop">{pair.blocking.name}</span>
          </div>
          <div className="db-cfg__row db-struct__row">
            <span className="label">{t('database.dep.conflict')}</span>
            <Segmented
              value={pair.onConflict}
              ariaLabel={t('database.dep.conflict')}
              items={(['shift', 'warn'] as const).map((v) => ({ value: v, label: t(`database.dep.conflict.${v}`) }))}
              onChange={(v) => setConflictMode(m.db.id, v)}
            />
          </div>
          <p className="db-struct__note">{t(`database.dep.conflictHint.${pair.onConflict}`)}</p>
          <p className="db-struct__note">{t('database.dep.howto')}</p>
        </>
      ) : (
        <p className="db-struct__note">{t('database.dep.hint')}</p>
      )}
    </Popover>
  )
}

/** The "turn off sub-items / dependencies?" dialog: keep the properties or delete them. */
export function TurnOffHost() {
  const t = useT()
  // every database view mounts a host; only the first one renders the dialog
  const id = useId()
  useEffect(() => {
    useTurnOff.setState((s) => ({ hosts: [...s.hosts, id] }))
    return () => useTurnOff.setState((s) => ({ hosts: s.hosts.filter((h) => h !== id) }))
  }, [id])
  const first = useTurnOff((s) => s.hosts[0] === id)
  const ask = useTurnOff((s) => s.ask)
  const db = useWorkspace((s) => (ask ? s.databases[ask.dbId] : undefined))
  const close = () => useTurnOff.getState().set(null)
  if (!first || !ask || !db) return null
  const sub = ask.kind === 'sub'
  const pair = sub ? subItemsOf(db) : dependenciesOf(db)
  const names = pair ? ('parent' in pair ? [pair.parent.name, pair.children.name] : [pair.blockedBy.name, pair.blocking.name]) : ['', '']
  const off = (del: boolean) => {
    close()
    if (sub) disableSubItems(db.id, del)
    else disableDependencies(db.id, del)
  }
  return (
    <Modal
      open
      onClose={close}
      label={sub ? t('database.sub.title') : t('database.dep.title')}
      title={t(sub ? 'database.sub.offTitle' : 'database.dep.offTitle')}
      width={460}
      className="db-struct-dialog"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={close}>
            {t('common.cancel')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" data-autofocus="" onClick={() => off(false)}>
            {t('database.struct.keep')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => off(true)}>
            {t('database.struct.delete')}
          </button>
        </>
      }
    >
      <p className="db-struct-dialog__body">{t(sub ? 'database.sub.offBody' : 'database.dep.offBody', { a: names[0], b: names[1] })}</p>
    </Modal>
  )
}
