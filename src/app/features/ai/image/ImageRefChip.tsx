/** The AI terminal's chip of an image reference: "▣ Protokoll P1 · image 1.2 MB" (× removes it). */
import { X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import type { TermRef } from '../agent/types'
import { formatBytes } from './load'

export function ImageRefChip({ r, onRemove }: { r: TermRef; onRemove: () => void }) {
  const t = useT()
  const lang = useLang()
  const bytes = r.image?.bytes
  const size = typeof bytes === 'number' ? t('features.ai.image.chip', { size: formatBytes(bytes, lang) }) : t('features.ai.image.chipWeb')
  return (
    <li className="term-chip" data-kind="image" title={r.markdown.slice(0, 400)} data-testid="term-image-chip">
      <span className="term-chip__glyph" aria-hidden>
        ▣
      </span>
      <span className="term-chip__text">{r.title}</span>
      <span className="term-chip__meta">· {size}</span>
      <button type="button" className="term-chip__x" onClick={onRemove} aria-label={t('features.agent.ctx.remove', { title: `${r.title} · ${size}` })}>
        <X size={11} strokeWidth={2} aria-hidden />
      </button>
    </li>
  )
}
