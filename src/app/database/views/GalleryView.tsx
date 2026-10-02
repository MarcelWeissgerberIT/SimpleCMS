/**
 * Gallery view: card grid with cover (page cover / first image in content / files property),
 * small/medium/large; "+ New" card.
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { pointAnchor } from '../../ui/Popover'
import { useModel } from '../hooks'
import { useViewActions, EmptyState } from './shared'
import { CardBody, CardPreview } from './cards'
import './views.css'

export function GalleryView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const size = m.view.cardSize ?? 'medium'
  const preview = m.view.cardPreview ?? 'cover'
  const [limit, setLimit] = useState(120)
  if (!m.rows.length) return <EmptyState onAdd={() => actions.newRow({ open: true })} />
  return (
    <div className="dbg" data-size={size}>
      {m.rows.slice(0, limit).map((row) => (
        <article
          key={row.id}
          className="dbc dbc--gallery"
          tabIndex={0}
          role="button"
          onClick={() => actions.open(row)}
          onKeyDown={(e) => e.key === 'Enter' && actions.open(row)}
          onContextMenu={(e) => {
            e.preventDefault()
            actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
          }}
        >
          {preview !== 'none' && <CardPreview m={m} row={row} preview={preview} reserve />}
          <CardBody m={m} row={row} props={m.visibleProps} />
        </article>
      ))}
      {m.rows.length > limit && (
        <button type="button" className="dbg-add" onClick={() => setLimit((l) => l + 240)}>
          <span className="label">{t('database.board.more', { count: m.rows.length - limit })}</span>
        </button>
      )}
      <button type="button" className="dbg-add" onClick={() => actions.newRow({ open: true })}>
        <Plus size={16} />
        <span className="label">{t('common.new')}</span>
      </button>
    </div>
  )
}
