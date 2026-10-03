import { useState, useSyncExternalStore } from 'react'
import { FileText, Database as DbIcon } from 'lucide-react'
import type { Page, PageIcon as PageIconT } from '../store/types'
import { resolveAssetUrl } from '../lib/files'
import './page-icon.css'

/**
 * Render a page icon — emoji, generated ceramic icon (asset) or lucide glyph — or a neutral
 * fallback glyph. Asset icons are cropped to their object and outlined at small sizes so they
 * stay legible on paper; a missing file or an unknown glyph falls back to the page glyph.
 */
export function PageIcon({ icon, kind = 'page', size = 18, fallback = true }: { icon: PageIconT | null | undefined; kind?: Page['kind']; size?: number; fallback?: boolean }) {
  const glyph = fallback ? <FallbackGlyph kind={kind} size={size} /> : null
  if (icon?.type === 'emoji')
    return (
      <span aria-hidden style={{ fontSize: size * 0.95, lineHeight: 1, width: size, height: size, display: 'inline-grid', placeItems: 'center', flex: 'none' }}>
        {icon.value}
      </span>
    )
  if (icon?.type === 'asset') return <AssetIcon key={icon.value} name={icon.value} size={size} fallback={glyph} />
  if (icon?.type === 'lucide') return <LucideGlyph name={icon.value} color={icon.color} size={size} fallback={glyph} />
  return glyph
}

function FallbackGlyph({ kind, size }: { kind: Page['kind']; size: number }) {
  const Glyph = kind === 'database' ? DbIcon : FileText
  return <Glyph size={size * 0.85} strokeWidth={1.6} style={{ flex: 'none', color: 'var(--ink-3)' }} aria-hidden />
}

/* ---------------- generated icons (public/assets/icons) ---------------- */

/** Names whose file failed to load in this session (no retry flicker on every render). */
const broken = new Set<string>()

function AssetIcon({ name, size, fallback }: { name: string; size: number; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(() => broken.has(name))
  if (failed) return fallback
  return (
    <span className="picon" data-small={size <= 32 || undefined} style={{ width: size, height: size }} aria-hidden>
      <img
        src={resolveAssetUrl(`assets/icons/${name}.webp`)}
        alt=""
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={() => {
          broken.add(name)
          setFailed(true)
        }}
      />
    </span>
  )
}

/* ---------------- lucide glyphs (loaded on first use) ---------------- */

type LucideModule = typeof import('./lucideIcons')
let lucide: LucideModule | null = null
let loading: Promise<LucideModule> | null = null
const waiters = new Set<() => void>()

export function loadLucideIcons(): Promise<LucideModule> {
  loading ??= import('./lucideIcons').then((m) => {
    lucide = m
    waiters.forEach((w) => w())
    return m
  })
  return loading
}

/** The lucide registry, once loaded (asks for it on first use). */
export function useLucideIcons(): LucideModule | null {
  return useSyncExternalStore(
    (cb) => {
      waiters.add(cb)
      if (!lucide) void loadLucideIcons()
      return () => {
        waiters.delete(cb)
      }
    },
    () => lucide,
    () => lucide,
  )
}

function LucideGlyph({ name, color, size, fallback }: { name: string; color?: string; size: number; fallback: React.ReactNode }) {
  const mod = useLucideIcons()
  const Icon = mod?.LUCIDE_BY_NAME[name]
  if (!Icon) return mod ? fallback : <span style={{ width: size, height: size, flex: 'none' }} aria-hidden />
  const tint = color && color !== 'default' ? `var(--c-${color}-text)` : undefined
  if (size < 40) return <Icon size={size} strokeWidth={1.75} style={{ flex: 'none', color: tint ?? 'var(--ink-2)' }} aria-hidden />
  // title size: an ink glyph on a paper placard with a hairline edge
  return (
    <span className="picon-tile" style={{ width: size, height: size }} aria-hidden>
      <Icon size={Math.round(size * 0.56)} absoluteStrokeWidth strokeWidth={Math.max(2, size / 30)} style={tint ? { color: tint } : undefined} />
    </span>
  )
}
