/** DANACH / AFTER: the row patch the send writes (typed values; refused ones struck through, with why) and the inbox notes it archives. */
import { useWorkspace } from '../../../store/store'
import type { PropertyValue } from '../../../store/types'
import { useT } from '../../../i18n'
import type { AfterEntry, Slip } from '../types'

function Box({ on }: { on: boolean }) {
  return <span className="obx-cbx" data-on={on || undefined} aria-hidden />
}

function Value({ v, entry, dbId }: { v: PropertyValue | null; entry: AfterEntry; dbId: string }) {
  const t = useT()
  const prop = useWorkspace((s) => (entry.propId ? s.databases[dbId]?.properties.find((p) => p.id === entry.propId) : undefined))
  if (prop?.type === 'checkbox' || typeof v === 'boolean') return <Box on={v === true} />
  if (v === null || v === '') return <span className="obx-after__empty">{t('features.outbox.after.empty')}</span>
  if ((prop?.type === 'select' || prop?.type === 'status') && typeof v === 'string') return <span>{prop.options?.find((o) => o.id === v)?.name ?? v}</span>
  if (typeof v === 'object' && v && !Array.isArray(v) && 'start' in v) return <span>{v.start}</span>
  return <span>{String(v)}</span>
}

export function After({ slip }: { slip: Slip }) {
  const t = useT()
  const notes = slip.answers.length
  if (!slip.after.length && !notes) return <p className="obx-after__row obx-after__none">{t('features.outbox.after.none')}</p>
  return (
    <ul className="obx-after" data-testid="outbox-after">
      {slip.after.map((e) => (
        <li key={e.ref} className="obx-after__row" data-refused={e.refused || undefined} title={e.refused ? t(`features.outbox.after.${e.refused}`) : undefined}>
          <b>{e.name}</b>
          <Value v={e.before} entry={e} dbId={slip.target.dbId} />
          <span className="obx-after__op" aria-hidden>
            →
          </span>
          <Value v={e.after} entry={e} dbId={slip.target.dbId} />
          {e.refused && <span className="obx-after__why">{t(`features.outbox.after.${e.refused}`)}</span>}
        </li>
      ))}
      {notes > 0 && <li className="obx-after__row">{notes === 1 ? t('features.outbox.after.archive') : t('features.outbox.after.archiveN', { n: notes })}</li>}
    </ul>
  )
}
