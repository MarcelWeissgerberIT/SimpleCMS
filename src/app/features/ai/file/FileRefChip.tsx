/** The AI terminal's chip of a file reference: "▤ Acme mail · PDF 1.2 MB" (× removes it). */
import { X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import type { TermRef } from '../agent/types'
import { fileKind, kindLabel } from './kinds'
import { formatBytes } from './load'

export function FileRefChip({ r, onRemove }: { r: TermRef; onRemove: () => void }) {
  const t = useT()
  const lang = useLang()
  const name = r.file?.name ?? ''
  const kind = fileKind(name)
  const type = kind ? kindLabel(kind, name) : name
  const bytes = r.file?.bytes
  const size = typeof bytes === 'number' ? t('features.ai.file.chip', { type, size: formatBytes(bytes, lang) }) : t('features.ai.file.chipWeb', { type })
  return (
    <li className="term-chip" data-kind="file" title={name} data-testid="term-file-chip">
      <span className="term-chip__glyph" aria-hidden>
        ▤
      </span>
      <span className="term-chip__text">{r.title}</span>
      <span className="term-chip__meta">· {size}</span>
      <button type="button" className="term-chip__x" onClick={onRemove} aria-label={t('features.agent.ctx.remove', { title: `${r.title} · ${name}` })}>
        <X size={11} strokeWidth={2} aria-hidden />
      </button>
    </li>
  )
}
