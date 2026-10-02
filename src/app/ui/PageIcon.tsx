import { FileText, Database as DbIcon } from 'lucide-react'
import type { Page, PageIcon as PageIconT } from '../store/types'
import { resolveAssetUrl } from '../lib/files'

/** Render a page icon (emoji / generated asset icon) or a neutral fallback glyph. */
export function PageIcon({ icon, kind = 'page', size = 18, fallback = true }: { icon: PageIconT | null | undefined; kind?: Page['kind']; size?: number; fallback?: boolean }) {
  if (icon?.type === 'emoji')
    return (
      <span aria-hidden style={{ fontSize: size * 0.95, lineHeight: 1, width: size, height: size, display: 'inline-grid', placeItems: 'center', flex: 'none' }}>
        {icon.value}
      </span>
    )
  if (icon?.type === 'asset')
    return <img src={resolveAssetUrl(`assets/icons/${icon.value}.webp`)} alt="" width={size} height={size} style={{ flex: 'none', objectFit: 'contain' }} draggable={false} />
  if (!fallback) return null
  const Glyph = kind === 'database' ? DbIcon : FileText
  return <Glyph size={size * 0.85} strokeWidth={1.6} style={{ flex: 'none', color: 'var(--ink-3)' }} aria-hidden />
}
