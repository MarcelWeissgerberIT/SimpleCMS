/**
 * Layout settings for the active view: layout type, grouping, card preview/size,
 * date property, feed order + content, chart config, wrap, open pages in.
 */
import type { FeedConfig, View, ViewType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { defaultView } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { VIEW_TYPES, BOARD_GROUP_TYPES, TABLE_GROUP_TYPES, isDateType } from '../model/schema'
import { Segmented, Select, TypeIcon } from '../parts'
import type { DbModel } from '../hooks'
import { ViewTypeIcon } from './ViewTabs'
import { SubItemsDisplayRow } from './StructurePanels'
import { subItemsOf } from '../model/hierarchy'
import { FEED_CREATED, feedDateProp } from '../model/feed'

export function LayoutPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const view = m.view
  const upd = (patch: Partial<View>) => useWorkspace.getState().updateView(m.db.id, view.id, patch)
  const props = m.db.properties

  const switchType = (type: ViewType) => {
    if (type === view.type) return
    const d = defaultView(type, m.db)
    const patch: Partial<View> = { type }
    if (type === 'board' && !(view.groupBy && BOARD_GROUP_TYPES.includes(m.propMap.get(view.groupBy)?.type ?? 'text'))) patch.groupBy = d.groupBy
    if ((type === 'calendar' || type === 'timeline') && !view.dateProperty) patch.dateProperty = d.dateProperty
    if (type === 'gallery') {
      patch.cardPreview = view.cardPreview ?? 'cover'
      patch.cardSize = view.cardSize ?? 'medium'
    }
    if (type === 'chart' && !view.chart) patch.chart = d.chart
    upd(patch)
  }

  const groupTypes = view.type === 'board' ? BOARD_GROUP_TYPES : TABLE_GROUP_TYPES
  const fileProps = props.filter((p) => p.type === 'files')
  const previewItems = [
    { value: 'none', label: t('database.layout.preview.none') },
    { value: 'cover', label: t('database.layout.preview.cover') },
    { value: 'content', label: t('database.layout.preview.content') },
    ...fileProps.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type="files" /> })),
  ]

  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-start" className="db-panel db-layout">
      <div className="db-panel__head">
        <span className="label">{t('database.layout.title')}</span>
        <span style={{ flex: 1 }} />
        <span className="label">{view.name}</span>
      </div>
      <div className="db-layout__types" role="radiogroup" aria-label={t('database.layout.type')}>
        {VIEW_TYPES.map((type) => (
          <button key={type} type="button" role="radio" aria-checked={view.type === type} className="db-layout__type" onClick={() => switchType(type)}>
            <ViewTypeIcon type={type} size={18} />
            <span>{t(`database.view.${type}`)}</span>
          </button>
        ))}
      </div>
      <div className="db-layout__opts">
        {(view.type === 'table' || view.type === 'list' || view.type === 'board') && (
          <div className="db-cfg__row">
            <span className="label">{t('database.group.by')}</span>
            <Select
              value={view.groupBy ?? '__none'}
              items={[
                ...(view.type === 'board' ? [] : [{ value: '__none', label: t('database.group.noGrouping') }]),
                ...props.filter((p) => groupTypes.includes(p.type)).map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> })),
              ]}
              onChange={(v) => upd({ groupBy: v === '__none' ? null : v, hiddenGroups: [] })}
            />
          </div>
        )}
        {subItemsOf(m.db) && view.type !== 'chart' && view.type !== 'form' && <SubItemsDisplayRow m={m} />}
        {(view.type === 'board' || view.type === 'gallery') && (
          <>
            <div className="db-cfg__row">
              <span className="label">{t('database.layout.cardPreview')}</span>
              <Select value={view.cardPreview ?? (view.type === 'gallery' ? 'cover' : 'none')} items={previewItems} onChange={(v) => upd({ cardPreview: v })} />
            </div>
            <div className="db-cfg__row">
              <span className="label">{t('database.layout.cardSize')}</span>
              <Segmented
                value={view.cardSize ?? 'medium'}
                items={(['small', 'medium', 'large'] as const).map((s) => ({ value: s, label: t(`database.layout.size.${s}`) }))}
                onChange={(v) => upd({ cardSize: v })}
              />
            </div>
          </>
        )}
        {(view.type === 'calendar' || view.type === 'timeline') && (
          <div className="db-cfg__row">
            <span className="label">{t('database.layout.dateProp')}</span>
            <Select
              value={view.dateProperty ?? null}
              placeholder={t('database.layout.pickDate')}
              items={props.filter((p) => isDateType(p.type)).map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
              onChange={(v) => upd({ dateProperty: v })}
            />
          </div>
        )}
        {view.type === 'feed' && <FeedOptions m={m} />}
        {view.type === 'table' && (
          <label className="db-cfg__row db-cfg__row--switch">
            <span>{t('database.layout.wrap')}</span>
            <Switch checked={!!view.wrapCells} label={t('database.layout.wrap')} onChange={(v) => upd({ wrapCells: v })} />
          </label>
        )}
        {view.type !== 'chart' && (
          <div className="db-cfg__row">
            <span className="label">{t('database.view.openIn')}</span>
            <Segmented
              value={view.openIn ?? 'peek'}
              items={(['peek', 'center', 'full'] as const).map((s) => ({ value: s, label: t(`database.view.openShort.${s}`) }))}
              onChange={(v) => upd({ openIn: v })}
            />
          </div>
        )}
      </div>
    </Popover>
  )
}

/** Feed: the date it orders by (created time unless a date property is picked), newest / oldest first, page content on / off. */
function FeedOptions({ m }: { m: DbModel }) {
  const t = useT()
  const feed = m.view.feed ?? {}
  const upd = (patch: Partial<FeedConfig>) => useWorkspace.getState().updateView(m.db.id, m.view.id, { feed: { ...feed, ...patch } })
  const current = feedDateProp(m.db, m.view)
  const dates = m.db.properties.filter((p) => isDateType(p.type) && p.type !== 'created_time')
  return (
    <>
      <div className="db-cfg__row">
        <span className="label">{t('database.feed.orderBy')}</span>
        <Select
          ariaLabel={t('database.feed.orderBy')}
          value={current === FEED_CREATED || current.type === 'created_time' ? FEED_CREATED.id : current.id}
          items={[{ value: FEED_CREATED.id, label: t('database.type.created_time'), icon: <TypeIcon type="created_time" /> }, ...dates.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))]}
          onChange={(v) => upd({ dateProperty: v === FEED_CREATED.id ? null : v })}
        />
      </div>
      <div className="db-cfg__row">
        <span className="label">{t('database.feed.order')}</span>
        <Segmented
          value={feed.order ?? 'newest'}
          items={(['newest', 'oldest'] as const).map((o) => ({ value: o, label: t(`database.feed.${o}`) }))}
          onChange={(v) => upd({ order: v })}
        />
      </div>
      <label className="db-cfg__row db-cfg__row--switch">
        <span>{t('database.feed.content')}</span>
        <Switch checked={feed.content !== false} label={t('database.feed.content')} onChange={(v) => upd({ content: v })} />
      </label>
    </>
  )
}
