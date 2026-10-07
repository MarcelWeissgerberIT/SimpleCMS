/** The pages a task refers to (@ mentions, links, One addresses in answers) — their text goes along to Claude Code; a hint when there are none. */
import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { taskRefs } from './refs'
import { useTaskLocal } from './local'

export function RefsLine({ taskId }: { taskId: ID }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const local = useTaskLocal(taskId)
  // One addresses in the answers and the rework note go along too
  const refs = useMemo(() => taskRefs(taskId, [...(local.answers ?? []).map((a) => a.a), local.rework?.text ?? '']), [taskId, pages, local]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ctk-refs" data-testid="coding-refs">
      <span className="label">{t('features.coding.refs.label')}</span>
      {refs.length ? (
        <span className="ctk-refs__list">
          {refs.map((r) => (
            <a key={r.id} href={`#/p/${r.id}`} className="ctk-refs__page" title={r.title}>
              <FileText size={12} strokeWidth={1.75} aria-hidden />
              <span>{r.title}</span>
            </a>
          ))}
        </span>
      ) : (
        <span className="ctk-hint">{t('features.coding.refs.none')}</span>
      )}
    </div>
  )
}
