/**
 * GELESEN / READ: what shaped the slip. Own pages and typed fields as plain chips; foreign text as a FREMD chip —
 * the "!" box, a hatched edge and the word, never colour alone. The comment comes first; the rest folds into "+n".
 */
import { FileText, Hash, PenLine, Brain } from 'lucide-react'
import { useT } from '../../../i18n'
import type { Slip, SourceRef } from '../types'
import { ForeignMark } from './parts'

const SHOWN_FOREIGN = 2

export function Sources({ slip }: { slip: Slip }) {
  const t = useT()
  const own = slip.sources.filter((s) => s.trusted)
  const typed = slip.sources.filter((s) => s.typed)
  const foreign = slip.sources.filter((s) => !s.trusted && !s.typed)
  // the comment first, then the rest
  foreign.sort((a, b) => Number(b.label.includes(' ')) - Number(a.label.includes(' ')))
  const shown = foreign.slice(0, SHOWN_FOREIGN)
  const rest = foreign.slice(SHOWN_FOREIGN)
  if (!slip.seal.complete && !slip.sources.length) return <p className="obx-read__none">{t('features.outbox.read.none')}</p>
  return (
    <div className="obx-read" data-testid="outbox-read">
      {own.map((s) => (
        <span key={`${s.kind}:${s.ref}`} className="obx-rchip" title={s.excerpt}>
          {s.kind === 'page' ? <FileText size={13} aria-hidden /> : s.kind === 'memory' ? <Brain size={13} aria-hidden /> : <PenLine size={13} aria-hidden />}
          {s.label}
        </span>
      ))}
      {typed.length > 0 && (
        <span className="obx-rchip" title={typed.map((s) => s.label).join(' · ')}>
          <Hash size={12} aria-hidden />
          <span className="obx-rchip__k">{t('features.outbox.src.typed')}</span>
          {typed.length}
        </span>
      )}
      {shown.map((s) => (
        <ForeignChip key={`${s.kind}:${s.ref}`} s={s} />
      ))}
      {rest.length > 0 && (
        <span className="obx-rchip obx-rchip--foreign" title={rest.map((s) => s.label).join(' · ')}>
          <ForeignMark />
          <span className="obx-rchip__k">{t('features.outbox.src.foreign')}</span>+{rest.length}
        </span>
      )}
    </div>
  )
}

function ForeignChip({ s }: { s: SourceRef }) {
  const t = useT()
  return (
    <span className="obx-rchip obx-rchip--foreign" title={s.excerpt} data-testid="outbox-foreign-chip">
      <ForeignMark />
      <span className="obx-rchip__k">{t('features.outbox.src.foreign')}</span>
      {s.label}
    </span>
  )
}
