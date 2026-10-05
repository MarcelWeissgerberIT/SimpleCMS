/**
 * Version history — the "Properties" block of Changes: what differs in a database entry between a
 * version and now. "Status: In progress → Done" with the old value struck (red tint) and the new one
 * marked (signal tint); options as colour chips (a multi-select as removed / added chips), dates,
 * numbers, people and relations as the cells show them, checkboxes as ☐ / ☑. Title and icon too.
 */
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import type { Database, Page, PageIcon, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { propertyValueToText } from '../../database'
import { diffProps, iconKey, isEmptyValue, type PropChangeRow, type SnapshotPropDef } from './props'
import type { SnapshotBody } from './snapshots'

export function PropsDiff({ body, page }: { body: SnapshotBody; page: Page }) {
  const t = useT()
  // re-read when the schema or the row changes
  const db = useWorkspace((s) => (body.props ? s.databases[body.props.databaseId] : undefined))
  const rows = body.props ? diffProps(body.props, page) : []
  const title = body.title !== page.title
  const icon = iconKey(body.icon) !== iconKey(page.icon)
  if (!rows.length && !(page.databaseId && (title || icon))) return null
  return (
    <section className="hprops" aria-label={t('features.history.props.title')} data-testid="hist-props">
      <span className="hprops__head label">{t('features.history.props.title')}</span>
      <dl className="hprops__list">
        {page.databaseId && title && (
          <Row name={t('features.history.titleLabel')}>
            <Pair before={<span>{body.title || t('common.untitled')}</span>} after={<span>{page.title || t('common.untitled')}</span>} />
          </Row>
        )}
        {icon && (
          <Row name={t('features.history.props.icon')}>
            <Pair before={<IconText icon={body.icon} />} after={<IconText icon={page.icon} />} emptyBefore={!body.icon} emptyAfter={!page.icon} />
          </Row>
        )}
        {rows.map((r) => (
          <PropRow key={r.id} row={r} db={db} page={page} />
        ))}
      </dl>
    </section>
  )
}

function Row({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className="hprops__row">
      <dt className="hprops__name">{name}</dt>
      <dd className="hprops__vals">
        {children}
        {note && <span className="hprops__note label">{note}</span>}
      </dd>
    </div>
  )
}

/** old → new: the old struck, the new marked; an empty side shows a dash. */
function Pair({ before, after, emptyBefore, emptyAfter }: { before: ReactNode; after: ReactNode; emptyBefore?: boolean; emptyAfter?: boolean }) {
  return (
    <>
      {emptyBefore ? <span className="hprops__empty">—</span> : <del className="ddiff-del hprops__v">{before}</del>}
      <span className="hprops__arrow mono" aria-hidden>
        →
      </span>
      {emptyAfter ? <span className="hprops__empty">—</span> : <ins className="ddiff-ins hprops__v">{after}</ins>}
    </>
  )
}

function IconText({ icon }: { icon: PageIcon | null }) {
  if (!icon) return null
  return <span>{icon.type === 'emoji' ? icon.value : icon.value.replace(/[-_]/g, ' ')}</span>
}

function PropRow({ row: r, db, page }: { row: PropChangeRow; db: Database | undefined; page: Page }) {
  const t = useT()
  const deleted = r.skip === 'deleted'
  const name = deleted ? `${r.name} ${t('features.history.props.deletedProp')}` : r.name
  const note = r.skip ? t(`features.history.props.skip.${r.skip}`) : undefined
  if (r.def.type === 'multi_select' && !deleted)
    return (
      <Row name={name} note={note}>
        <ChipDiff before={ids(r.before)} after={ids(r.after)} options={r.def.options} />
      </Row>
    )
  return (
    <Row name={name} note={note}>
      <Pair
        before={<Value def={r.then.type === r.def.type ? r.def : r.then} value={r.before} db={db} page={page} />}
        after={<Value def={r.def} value={r.after} db={db} page={page} />}
        emptyBefore={isEmptyValue(r.before ?? undefined)}
        emptyAfter={isEmptyValue(r.after ?? undefined) || deleted}
      />
    </Row>
  )
}

const ids = (v: PropertyValue | null): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [])

function Chip({ option, id }: { option: SelectOption | undefined; id: string }) {
  const color = option?.color ?? 'default'
  return (
    <span className="hprops__chip" style={{ '--chip-bg': `var(--c-${color}-bg)`, '--chip-fg': `var(--c-${color}-text)` } as React.CSSProperties}>
      {option?.name ?? id}
    </span>
  )
}

/** A multi-select: kept chips plain, removed ones struck, added ones marked. */
function ChipDiff({ before, after, options }: { before: string[]; after: string[]; options: SelectOption[] | undefined }) {
  const opt = (id: string) => options?.find((o) => o.id === id)
  const gone = before.filter((id) => !after.includes(id))
  return (
    <span className="hprops__chips">
      {after.map((id) =>
        before.includes(id) ? (
          <Chip key={id} id={id} option={opt(id)} />
        ) : (
          <ins key={id} className="ddiff-ins">
            <Chip id={id} option={opt(id)} />
          </ins>
        ),
      )}
      {gone.map((id) => (
        <del key={id} className="ddiff-del">
          <Chip id={id} option={opt(id)} />
        </del>
      ))}
    </span>
  )
}

/** One value as the cells show it. */
function Value({ def, value, db, page }: { def: SnapshotPropDef; value: PropertyValue | null; db: Database | undefined; page: Page }) {
  if (isEmptyValue(value ?? undefined)) return null
  if (def.type === 'checkbox') return <span className="mono">{value ? '☑' : '☐'}</span>
  if (def.type === 'select' || def.type === 'status')
    return (
      <span className="hprops__chips">
        {ids(value).map((id) => (
          <Chip key={id} id={id} option={def.options?.find((o) => o.id === id)} />
        ))}
      </span>
    )
  const prop = def as PropertyDef
  const fakeDb: Database = { id: db?.id ?? page.databaseId ?? '', views: [], nextUniqueId: 1, ...(db ?? {}), properties: [prop] }
  const text = propertyValueToText(fakeDb, prop, { ...page, properties: { ...page.properties, [def.id]: value as PropertyValue } })
  return <span>{text || String(value)}</span>
}
