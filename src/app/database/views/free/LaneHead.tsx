/**
 * A free board's lane header: rename (double-click / menu), colour, move left / right, delete (a lane with
 * cards asks where they go). "+" adds a card (the record types to pick from). Locked: no lane changes.
 */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronsLeftRight, Ellipsis, Eye, Palette, Pencil, Plus, Trash } from 'lucide-react'
import { COLOR_NAMES } from '../../../store/types'
import type { DbModel } from '../../hooks'
import type { RowGroup } from '../../model/query'
import { NONE_KEY } from '../../model/query'
import { useT } from '../../../i18n'
import { Modal } from '../../../ui/Modal'
import { Menu, Select } from '../../parts'
import { GroupLabel } from '../shared'
import { deleteLane, moveLane, recolorLane, renameLane } from './lanes'

export function LaneHead({
  m,
  group,
  index,
  count,
  laneId,
  lanes,
  onAdd,
  onCollapse,
  onHide,
}: {
  m: DbModel
  group: RowGroup
  index: number
  count: number
  laneId: string
  lanes: RowGroup[]
  onAdd: (el: HTMLElement) => void
  onCollapse: () => void
  onHide: () => void
}) {
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(group.label)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const real = group.key !== NONE_KEY
  const editable = real && !m.fixed
  const pos = lanes.filter((g) => g.key !== NONE_KEY).findIndex((g) => g.key === group.key)
  const total = lanes.filter((g) => g.key !== NONE_KEY).length
  const finish = (save: boolean) => {
    if (save && name.trim() && name.trim() !== group.label) renameLane(m.db.id, laneId, group.key, name)
    setRenaming(false)
  }
  return (
    <header className="dbb-col__head fb-lanehead" data-lane={group.key}>
      <span className="dbb-col__idx">{String.fromCharCode(65 + (index % 26))}</span>
      {renaming ? (
        <input
          className="fb-lanehead__input"
          autoFocus
          value={name}
          aria-label={t('database.free.renameLane')}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') finish(true)
            if (e.key === 'Escape') finish(false)
          }}
        />
      ) : (
        <span
          className="fb-lanehead__label"
          onDoubleClick={() => {
            if (!editable) return
            setName(group.label)
            setRenaming(true)
          }}
        >
          <GroupLabel group={group} />
        </span>
      )}
      <span className="dbb-count">{count}</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="icon-btn icon-btn--sm" aria-label={`${t('database.free.laneMenu')}: ${group.label}`} onClick={(e) => setMenu(e.currentTarget)}>
        <Ellipsis size={14} />
      </button>
      {!m.readOnly && (
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.free.addCard', { lane: group.label })} data-testid="fb-lane-add" onClick={(e) => onAdd(e.currentTarget)}>
          <Plus size={14} />
        </button>
      )}
      <Menu
        open={!!menu}
        anchor={menu}
        onClose={() => setMenu(null)}
        entries={[
          ...(editable
            ? [
                {
                  label: t('database.free.renameLane'),
                  icon: <Pencil size={14} />,
                  onSelect: () => {
                    setName(group.label)
                    setRenaming(true)
                  },
                },
                {
                  label: t('database.free.laneColor'),
                  icon: <Palette size={14} />,
                  submenu: COLOR_NAMES.map((c) => ({
                    label: t(`color.${c}`),
                    icon: <span className="fb-swatch" style={{ ['--rt' as string]: `var(--c-${c}-text)` }} />,
                    checked: group.color === c,
                    onSelect: () => recolorLane(m.db.id, laneId, group.key, c),
                  })),
                },
                { label: t('database.free.moveLeft'), icon: <ArrowLeft size={14} />, disabled: pos <= 0, onSelect: () => moveLane(m.db.id, laneId, group.key, -1) },
                { label: t('database.free.moveRight'), icon: <ArrowRight size={14} />, disabled: pos < 0 || pos >= total - 1, onSelect: () => moveLane(m.db.id, laneId, group.key, 1) },
                { kind: 'separator' as const },
              ]
            : []),
          { label: t('database.group.collapse'), icon: <ChevronsLeftRight size={14} />, onSelect: onCollapse },
          ...(m.fixed ? [] : [{ label: t('database.group.hide'), icon: <Eye size={14} />, onSelect: onHide }]),
          ...(editable
            ? [
                { kind: 'separator' as const },
                {
                  label: t('database.free.deleteLane'),
                  icon: <Trash size={14} />,
                  danger: true,
                  onSelect: () => (count > 0 ? setDeleting(true) : deleteLane(m.db.id, laneId, group.key, null)),
                },
              ]
            : []),
        ]}
      />
      {deleting && <DeleteLane m={m} laneId={laneId} group={group} count={count} lanes={lanes} onClose={() => setDeleting(false)} />}
    </header>
  )
}

/** "Delete lane — where do its N cards go?" */
function DeleteLane({ m, laneId, group, count, lanes, onClose }: { m: DbModel; laneId: string; group: RowGroup; count: number; lanes: RowGroup[]; onClose: () => void }) {
  const t = useT()
  const others = lanes.filter((g) => g.key !== NONE_KEY && g.key !== group.key)
  const [to, setTo] = useState<string>(others[0]?.key ?? NONE_KEY)
  return (
    <Modal
      open
      onClose={onClose}
      label={t('database.free.label')}
      title={t('database.free.deleteTitle', { lane: group.label })}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="fb-delete-lane"
            onClick={() => {
              deleteLane(m.db.id, laneId, group.key, to === NONE_KEY ? null : to)
              onClose()
            }}
          >
            {t('database.free.deleteLane')}
          </button>
        </>
      }
    >
      <div className="fb-delete">
        <p>{t(count === 1 ? 'database.free.deleteBody.one' : 'database.free.deleteBody.other', { count })}</p>
        <Select
          value={to}
          ariaLabel={t('database.free.moveCardsTo')}
          items={[...others.map((g) => ({ value: g.key, label: g.label })), { value: NONE_KEY, label: t('database.free.noLane') }]}
          onChange={setTo}
        />
      </div>
    </Modal>
  )
}
