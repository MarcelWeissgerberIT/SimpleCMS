/**
 * #/kit — Building blocks (loaded on first visit): three tabs — Lists · Property types · Record types —
 * each an index of instrument rows (LS-01 …) beside the editor of the open one (#/kit/<tab>/<id>). At
 * phone width the index and the editor take turns (a back link). New blocks start with a default name;
 * a property type picks its base first (fixed once created).
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Blocks, List as ListIcon, Plus, Shapes, SquareStack } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { CUSTOM_BASES, storedTypeOf } from '../../store/kit'
import type { CustomPropBase, ID, Kit } from '../../store/types'
import { useT } from '../../i18n'
import { tagStyle } from '../../lib/colors'
import { navigate } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { Menu } from '../../ui/Menu'
import { HelpLink } from '../../help'
import { TypeIcon } from '../../database'
import { createList, createPropType, createRecordType } from './model'
import { consumeCreateRequest, type KitTab } from './open'
import { ListEditor } from './ListEditor'
import { TypeEditor, baseLabel } from './TypeEditor'
import { RecordEditor } from './RecordEditor'
import { pad2 } from './ui'
import '../script/script.css'
import './kit.css'

const TABS: Array<{ id: KitTab; icon: typeof ListIcon; code: string }> = [
  { id: 'lists', icon: ListIcon, code: 'LS' },
  { id: 'types', icon: Shapes, code: 'PT' },
  { id: 'records', icon: SquareStack, code: 'RT' },
]

const byCreated = <T extends { createdAt: number; name: string }>(xs: T[]) => [...xs].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))

export function useKitEntries(kit: Kit | undefined) {
  return useMemo(
    () => ({
      lists: byCreated(Object.values(kit?.lists ?? {})),
      types: byCreated(Object.values(kit?.propTypes ?? {})),
      records: byCreated(Object.values(kit?.recordTypes ?? {})),
    }),
    [kit],
  )
}

export default function KitView({ tab = 'lists', id }: { tab?: KitTab; id?: string }) {
  const t = useT()
  const kit = useWorkspace((s) => s.kit)
  const readOnly = useCloud((s) => s.readOnly)
  const entries = useKitEntries(kit)
  const [baseAnchor, setBaseAnchor] = useState<HTMLElement | null>(null)
  const [newKey, setNewKey] = useState<HTMLButtonElement | null>(null)

  // "New own type…" from a database's type picker: open the base menu right away
  useEffect(() => {
    if (tab === 'types' && !readOnly && consumeCreateRequest() && newKey) setBaseAnchor(newKey)
  }, [tab, readOnly, newKey])

  const list = tab === 'lists' ? entries.lists : tab === 'types' ? entries.types : entries.records
  const open = id ? list.findIndex((x) => x.id === id) : -1
  const current = open >= 0 ? list[open] : null

  const go = (to: KitTab, entry?: ID) => navigate(entry ? `#/kit/${to}/${entry}` : `#/kit/${to}`)
  const create = () => {
    if (tab === 'lists') {
      const nid = createList({ name: t('features.kit.lists.newName') })
      if (nid) go('lists', nid)
    } else if (tab === 'records') {
      const nid = createRecordType({ name: t('features.kit.records.newName') })
      if (nid) go('records', nid)
    }
  }
  const createType = (base: CustomPropBase) => {
    const nid = createPropType({ name: t('features.kit.types.newName', { base: baseLabel(t, base) }), base })
    if (nid) go('types', nid)
  }

  const counts = t('features.kit.count', { l: pad2(entries.lists.length), p: pad2(entries.types.length), r: pad2(entries.records.length) })

  return (
    <div className="kt" data-tab={tab} data-open={current ? '' : undefined}>
      <header className="kt-head">
        <div className="kt-head__meta label">
          <span className="kt-head__sec">§ KIT</span>
          <span className="kt-hide-narrow">{t('features.kit.kicker')}</span>
          <span className="kt-rule" aria-hidden />
          <span className="mono" data-testid="kt-count">
            {counts}
          </span>
          <HelpLink id="building-blocks" />
        </div>
        <div className="kt-head__row">
          <h1 className="kt-title">{t('features.kit.title')}</h1>
          {!readOnly && (
            <button
              ref={setNewKey}
              type="button"
              className="btn btn--primary"
              data-testid="kt-new"
              onClick={(e) => (tab === 'types' ? setBaseAnchor(e.currentTarget) : create())}
            >
              <Plus size={14} strokeWidth={1.9} aria-hidden /> {t(`features.kit.${tab}.new`)}
            </button>
          )}
        </div>
        <p className="kt-lead">{t('features.kit.lead')}</p>
        {readOnly && <p className="kt-note">{t('features.kit.readOnly')}</p>}
        <nav className="kt-tabs" role="tablist" aria-label={t('features.kit.title')}>
          {TABS.map((x) => {
            const n = x.id === 'lists' ? entries.lists.length : x.id === 'types' ? entries.types.length : entries.records.length
            const I = x.icon
            return (
              <a key={x.id} role="tab" aria-selected={tab === x.id} className="kt-tab kt-tab--main" href={`#/kit/${x.id}`} data-testid={`kt-tab-${x.id}`}>
                <I size={14} strokeWidth={1.75} aria-hidden />
                <span>{t(`features.kit.tab.${x.id}`)}</span>
                <span className="kt-tab__n mono">{pad2(n)}</span>
              </a>
            )
          })}
        </nav>
      </header>
      <div className="kt-body">
        <aside className="kt-index" aria-label={t(`features.kit.tab.${tab}`)}>
          {list.length ? (
            <ul className="kt-rows">
              {list.map((x, i) => (
                <li key={x.id}>
                  <a className="kt-row" href={`#/kit/${tab}/${x.id}`} aria-current={x.id === id ? 'page' : undefined} data-testid="kt-row">
                    <span className="kt-row__code label">
                      {TABS.find((y) => y.id === tab)!.code}-{pad2(i + 1)}
                    </span>
                    <span className="kt-row__icon">{rowIcon(tab, x)}</span>
                    <span className="kt-row__name">{x.name}</span>
                    <span className="kt-row__meta label">{rowMeta(t, tab, x)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty tab={tab} />
          )}
        </aside>
        <section className="kt-detail" aria-live="polite">
          {current && (
            <a className="kt-back" href={`#/kit/${tab}`}>
              <ArrowLeft size={14} strokeWidth={1.8} aria-hidden /> {t(`features.kit.tab.${tab}`)}
            </a>
          )}
          {current && tab === 'lists' && <ListEditor key={current.id} list={entries.lists[open]} n={open + 1} />}
          {current && tab === 'types' && <TypeEditor key={current.id} type={entries.types[open]} n={open + 1} />}
          {current && tab === 'records' && <RecordEditor key={current.id} rt={entries.records[open]} n={open + 1} />}
          {!current && id && <p className="kt-empty-line">{t('features.kit.gone')}</p>}
          {!current && !id && list.length > 0 && (
            <div className="kt-pick-hint">
              <Blocks size={22} strokeWidth={1.5} aria-hidden />
              <span>{t(`features.kit.${tab}.pick`)}</span>
            </div>
          )}
        </section>
      </div>
      <Menu
        open={!!baseAnchor}
        anchor={baseAnchor}
        onClose={() => setBaseAnchor(null)}
        placement="bottom-end"
        entries={[
          { kind: 'section', label: t('features.kit.types.pickBase') },
          ...CUSTOM_BASES.map((b) => ({ label: baseLabel(t, b), icon: <TypeIcon type={storedTypeOf(b)} />, hint: b === 'free' ? t('features.kit.base.freeHint') : undefined, onSelect: () => createType(b) })),
        ]}
      />
    </div>
  )
}

type AnyEntry = { id: ID; name: string; icon?: import('../../store/types').PageIcon | null; items?: unknown[]; base?: CustomPropBase; properties?: unknown[]; color?: import('../../store/types').ColorName; scripts?: import('../../store/types').CustomPropScripts }

function rowIcon(tab: KitTab, x: AnyEntry) {
  if (x.icon) return <PageIcon icon={x.icon} size={16} />
  if (tab === 'types' && x.base) return <TypeIcon type={storedTypeOf(x.base)} size={15} />
  if (tab === 'records') return <span className="kt-dot kt-dot--lg" style={tagStyle(x.color ?? 'default')} aria-hidden />
  return <ListIcon size={15} strokeWidth={1.7} aria-hidden />
}

function rowMeta(t: ReturnType<typeof useT>, tab: KitTab, x: AnyEntry): string {
  if (tab === 'lists') return t('features.kit.lists.meta', { n: x.items?.length ?? 0 })
  if (tab === 'records') return t('features.kit.records.meta', { n: x.properties?.length ?? 0 })
  const scripts = Object.values(x.scripts ?? {}).filter(Boolean).length
  const base = x.base ? baseLabel(t, x.base).toUpperCase() : ''
  return scripts ? `${base} · ƒ ${scripts}` : base
}

function Empty({ tab }: { tab: KitTab }) {
  const t = useT()
  return (
    <div className="kt-emptybox" data-testid="kt-empty">
      <p className="kt-emptybox__title">{t(`features.kit.${tab}.emptyTitle`)}</p>
      <p className="kt-emptybox__text">{t(`features.kit.${tab}.emptyText`)}</p>
    </div>
  )
}
