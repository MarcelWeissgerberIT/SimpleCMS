/**
 * One memory in the AI menu: the "MEMORY · 3" line under the reads line (what goes along with an own
 * request — or went along with the run shown), and the live preview behind it.
 */
import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { memoryFor } from './use'
import type { MemoryUse } from './types'
import './memory.css'

/** What an own request with this text would take along (null: the memory is not in use). */
export function useMemoryPreview(text: string, on: boolean, off: boolean): MemoryUse | null {
  // re-pick when the memory or its switches change (rows saved meanwhile count from the next keystroke)
  const settings = useWorkspace((s) => s.settings.memory)
  const dbs = useWorkspace((s) => s.databases)
  return useMemo(() => (on ? memoryFor(text, { off }).use : null), [text, on, off, settings, dbs]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function MemoryLine({ use, open, onToggle, disabled }: { use: MemoryUse; open: boolean; onToggle: () => void; disabled?: boolean }) {
  const t = useT()
  const n = use.items.length
  const names = use.items.map((x) => `${x.label} ${x.text}`).join(' · ')
  return (
    <button
      type="button"
      className="mem-line-btn"
      data-open={open || undefined}
      data-off={use.off || undefined}
      data-testid="ai-memory"
      aria-expanded={open}
      disabled={disabled}
      title={t('features.memory.chipTitle')}
      onClick={onToggle}
    >
      <span className={`led${!use.off && n ? ' led--on' : ''}`} aria-hidden />
      <span className="mem-line-btn__k">{use.off ? t('features.memory.chipOff') : t('features.memory.chip', { count: n })}</span>
      {!use.off && n > 0 && (
        <>
          <span className="mem-line-btn__sep" aria-hidden>
            ·
          </span>
          <span className="mem-line-btn__v">{names}</span>
        </>
      )}
      <ChevronDown className="mem-line-btn__chev" size={12} strokeWidth={1.8} aria-hidden />
    </button>
  )
}
