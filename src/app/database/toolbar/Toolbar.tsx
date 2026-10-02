/**
 * Instrument-panel toolbar: search, filter, sort, group, properties, automations, more, record
 * counter and the "New" split button.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Download, Ellipsis, Funnel, Group, LayoutTemplate, Link, Maximize2, Search, SlidersHorizontal, X, Zap } from 'lucide-react'
import { useUI } from '../../store/ui'
import { Menu } from '../../ui/Menu'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { openPage, pageHref } from '../../lib/router'
import { countFilters } from '../model/query'
import { exportCsv } from '../model/actions'
import type { DbModel } from '../hooks'
import { FilterPopover } from './Filters'
import { GroupPanel, PropertiesPanel, SortPanel } from './Panels'
import { LayoutPanel } from './LayoutPanel'
import { NewButton, type Template } from './Templates'
import { formatCount } from '../model/format'

type PanelKind = 'filter' | 'sort' | 'group' | 'props' | 'layout' | 'more'

function ToolButton({ icon, label, count, active, onClick, compact, pressed }: { icon: React.ReactNode; label: string; count?: number; active?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; compact?: boolean; pressed?: boolean }) {
  const btn = (
    <button type="button" className="db-tool" data-active={!!active} aria-pressed={pressed} aria-label={label} onClick={onClick}>
      {icon}
      {!compact && <span className="db-tool__label">{label}</span>}
      {active && <span className="led led--on db-tool__led" aria-hidden />}
      {!!count && count > 0 && <span className="db-tool__count">{count}</span>}
    </button>
  )
  return compact ? <Tooltip label={label}>{btn}</Tooltip> : btn
}

export function Toolbar({ m, onNew, setSearch, compact }: { m: DbModel; onNew: (tpl?: Template) => void; setSearch: (q: string) => void; compact?: boolean }) {
  const t = useT()
  const [panel, setPanel] = useState<{ kind: PanelKind; el: Element } | null>(null)
  const [searchOpen, setSearchOpen] = useState(!!m.search)
  const searchRef = useRef<HTMLInputElement>(null)
  const view = m.view
  const filterCount = countFilters(view.filter)
  const automations = (m.db.automations ?? []).filter((a) => a.enabled).length
  const canGroup = view.type === 'table' || view.type === 'list' || view.type === 'board'

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const toggle = (kind: PanelKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    setPanel((p) => (p?.kind === kind ? null : { kind, el }))
  }
  const close = () => setPanel(null)
  const filtered = m.rows.length !== m.allRows.length

  return (
    <div className="db-toolbar" role="toolbar" aria-label={t('database.toolbar')}>
      <div className={`db-search${searchOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="db-tool"
          aria-label={t('database.search')}
          data-active={!!m.search}
          onClick={() => {
            if (searchOpen && !m.search) setSearchOpen(false)
            else setSearchOpen(true)
          }}
        >
          <Search size={14} />
        </button>
        {searchOpen && (
          <>
            <input
              ref={searchRef}
              className="db-search__input"
              value={m.search}
              placeholder={t('database.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearch('')
                  setSearchOpen(false)
                }
              }}
              onBlur={() => !m.search && setSearchOpen(false)}
            />
            {m.search && (
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.close')} onClick={() => (setSearch(''), setSearchOpen(false))}>
                <X size={12} />
              </button>
            )}
          </>
        )}
      </div>
      <ToolButton compact={compact} icon={<Funnel size={14} />} label={t('database.filter.title')} count={filterCount} active={filterCount > 0} pressed={panel?.kind === 'filter'} onClick={toggle('filter')} />
      <ToolButton compact={compact} icon={<ArrowUpDown size={14} />} label={t('database.sort.title')} count={view.sorts.length} active={view.sorts.length > 0} pressed={panel?.kind === 'sort'} onClick={toggle('sort')} />
      {canGroup && <ToolButton compact={compact} icon={<Group size={14} />} label={t('database.group.title')} active={!!view.groupBy} pressed={panel?.kind === 'group'} onClick={toggle('group')} />}
      <ToolButton compact icon={<SlidersHorizontal size={14} />} label={t('database.props.title')} pressed={panel?.kind === 'props'} onClick={toggle('props')} />
      <ToolButton compact icon={<Zap size={14} />} label={t('database.automations')} count={automations} active={automations > 0} onClick={() => useUI.getState().openModal({ type: 'automations', databaseId: m.db.id })} />
      <ToolButton compact icon={<Ellipsis size={15} />} label={t('common.more')} pressed={panel?.kind === 'more'} onClick={toggle('more')} />
      <span className="db-counter" title={t('database.counterTitle')} aria-label={t('database.counterTitle')}>
        <span className="db-counter__label">{t('database.rec')}</span>
        <span className="db-counter__num">{filtered ? `${formatCount(m.rows.length, m.resolver.ctx.lang, 0)}/${formatCount(m.allRows.length, m.resolver.ctx.lang, 0)}` : formatCount(m.allRows.length, m.resolver.ctx.lang, 0)}</span>
      </span>
      <NewButton m={m} onNew={onNew} />

      {panel?.kind === 'filter' && <FilterPopover m={m} anchor={panel.el} onClose={close} />}
      {panel?.kind === 'sort' && <SortPanel m={m} anchor={panel.el} onClose={close} />}
      {panel?.kind === 'group' && <GroupPanel m={m} anchor={panel.el} onClose={close} />}
      {panel?.kind === 'props' && <PropertiesPanel m={m} anchor={panel.el} onClose={close} />}
      {panel?.kind === 'layout' && <LayoutPanel m={m} anchor={panel.el} onClose={close} />}
      <Menu
        open={panel?.kind === 'more'}
        anchor={panel?.kind === 'more' ? panel.el : null}
        onClose={close}
        placement="bottom-end"
        entries={[
          {
            label: t('database.view.layout'),
            icon: <LayoutTemplate size={14} />,
            keepOpen: true,
            onSelect: () => setPanel((p) => (p ? { kind: 'layout', el: p.el } : p)),
          },
          { label: t('database.exportCsv'), icon: <Download size={14} />, onSelect: () => exportCsv(m.resolver, m.db, [m.titleProp, ...m.visibleProps], m.rows, m.dbPage.title || t('common.untitled')) },
          {
            label: t('common.copyLink'),
            icon: <Link size={14} />,
            onSelect: () => {
              const url = `${location.origin}${location.pathname}${pageHref(m.db.id)}`
              void navigator.clipboard?.writeText(url).then(() => useUI.getState().toast(t('common.copied')))
            },
          },
          ...(m.inline ? [{ label: t('database.openFull'), icon: <Maximize2 size={14} />, onSelect: () => openPage(m.db.id) }] : []),
        ]}
      />
    </div>
  )
}
