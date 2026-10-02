/**
 * Cover presets. DOCUMENTED EXCEPTION to "no raw hex outside tokens.css": the value is
 * stored in page.cover and travels into exports and shared links, where the app's tokens
 * do not exist — so it has to be literal CSS. Brand palette only: paper, ink,
 * international orange and a few earth tones. Names: shell.cover.g.<id>.
 */
export interface GradientPreset {
  id: string
  value: string
}

export const GRADIENTS: GradientPreset[] = [
  { id: 'signal', value: 'linear-gradient(135deg, #ff6a1f 0%, #ff4f00 45%, #c43c00 100%)' },
  { id: 'horizon', value: 'linear-gradient(180deg, #f2f0ea 0%, #f2f0ea 61%, #ff4f00 61%, #ff4f00 63.5%, #121210 63.5%, #22211e 100%)' },
  { id: 'ember', value: 'linear-gradient(115deg, #121210 0%, #2a1a10 45%, #c43c00 85%, #ff4f00 100%)' },
  { id: 'hazard', value: 'repeating-linear-gradient(-45deg, #ff4f00 0 22px, #121210 22px 44px)' },
  { id: 'graph', value: 'linear-gradient(rgba(18,18,16,.10) 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, rgba(18,18,16,.10) 1px, transparent 1px) 0 0 / 22px 22px, #f2f0ea' },
  { id: 'dots', value: 'radial-gradient(rgba(18,18,16,.28) 1.2px, transparent 1.6px) 0 0 / 14px 14px, #eae7df' },
  { id: 'carbon', value: 'repeating-linear-gradient(0deg, #181816 0 2px, #1f1e1b 2px 4px)' },
  { id: 'sand', value: 'linear-gradient(160deg, #f6ebc7 0%, #eee0d4 55%, #dfdbd1 100%)' },
  { id: 'clay', value: 'linear-gradient(135deg, #eee0d4 0%, #c79a7a 100%)' },
  { id: 'moss', value: 'linear-gradient(150deg, #dcecd8 0%, #8fbf8a 100%)' },
  { id: 'dusk', value: 'linear-gradient(180deg, #ff8a52 0%, #ff4f00 38%, #3d2416 78%, #121210 100%)' },
  { id: 'paper', value: 'linear-gradient(180deg, #faf9f5 0%, #dfdbd1 100%)' },
]

export interface CoverManifestEntry {
  name: string
  label?: string
  webp?: string
  file?: string
  src?: string
}

let manifest: Promise<CoverManifestEntry[]> | null = null
export function loadCoverManifest(resolve: (p: string) => string): Promise<CoverManifestEntry[]> {
  manifest ??= fetch(resolve('assets/covers/manifest.json'))
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? d : Array.isArray(d?.covers) ? d.covers : []))
    .catch(() => [])
  return manifest
}

export function coverAssetPath(e: CoverManifestEntry): string {
  const f = e.src ?? e.webp ?? e.file ?? `${e.name}.webp`
  return f.startsWith('assets/') ? f : `assets/covers/${f}`
}
