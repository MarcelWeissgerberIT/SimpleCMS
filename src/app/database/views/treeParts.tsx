/**
 * Sub-items chrome shared by table and list rows: the indented toggle lead and the
 * "add sub-item" button.
 */
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { useT } from '../../i18n'
import { MAX_INDENT } from './tree'

const STEP = 16
/** x of the connector line of level k (1-based): the centre of that level's toggle */
const railX = (k: number) => (k - 1) * STEP + 11

/** Hairline connector rails of the ancestors whose branches continue past this row. */
function railsBackground(rails: string): string | undefined {
  const layers: string[] = []
  for (let k = 1; k <= rails.length && k <= MAX_INDENT; k++)
    if (rails[k - 1] === '1') layers.push(`linear-gradient(var(--rule-strong), var(--rule-strong)) ${railX(k)}px 0 / 1px 100% no-repeat`)
  return layers.length ? layers.join(', ') : undefined
}

export function TreeLead({
  depth,
  kids,
  open,
  title,
  onToggle,
  tabbable,
  last,
  rails,
}: {
  depth: number
  kids: number
  open: boolean
  title: string
  onToggle: () => void
  tabbable?: boolean
  last: boolean
  rails: string
}) {
  const t = useT()
  const level = Math.min(depth, MAX_INDENT)
  return (
    <span
      className="db-tree"
      data-child={depth > 0}
      data-last={last}
      data-open={open && kids > 0}
      style={{ ['--tree-indent' as string]: level, ['--tree-elbow' as string]: `${railX(level)}px`, background: railsBackground(rails) }}
    >
      {kids > 0 && (
        <button
          type="button"
          className="db-tree__toggle"
          tabIndex={tabbable ? 0 : -1}
          aria-expanded={open}
          aria-label={t(open ? 'database.sub.collapse' : 'database.sub.expand', { title, count: kids })}
          title={t(open ? 'database.sub.collapse' : 'database.sub.expand', { title, count: kids })}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      )}
    </span>
  )
}

/** Collapsed parents show how many sub-items they hold. */
export function TreeCount({ kids, open }: { kids: number; open: boolean }) {
  if (!kids || open) return null
  return (
    <span className="db-tree__n" aria-hidden>
      {kids}
    </span>
  )
}

export function AddSubButton({ onAdd, tabbable }: { onAdd: () => void; tabbable?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      className="db-open db-addsub"
      tabIndex={tabbable ? 0 : -1}
      aria-label={t('database.sub.add')}
      title={t('database.sub.add')}
      onClick={(e) => {
        e.stopPropagation()
        onAdd()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <CornerDownRight size={12} strokeWidth={2} />
    </button>
  )
}
