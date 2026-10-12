/**
 * Capability lamps (UX § 9): Tools · JSON · Images · PDF natively · MCP — a letter on ink when present, a dashed
 * outline when absent (never colour alone); each lamp's title / name says it in words.
 */
import type { Caps } from '@/shared/ai/types'
import type { CatalogRow } from '@/shared/ai/catalog'
import { useT } from '../../../i18n'
import '../setup/plates.css'

export interface Lamps {
  tools: boolean
  json: boolean
  images: boolean
  pdf: boolean
  mcp: boolean
}

const KEYS: ReadonlyArray<keyof Lamps> = ['tools', 'json', 'images', 'pdf', 'mcp']

export const lampsOfRow = (r: CatalogRow): Lamps => ({
  tools: r.params.includes('tools'),
  json: r.params.includes('structured_outputs') || r.params.includes('response_format'),
  images: r.inputs.image,
  pdf: r.inputs.file,
  mcp: false,
})

export const lampsOfCaps = (c: Caps | null | undefined): Lamps => ({ tools: !!c?.tools, json: !!c?.structured, images: !!c?.vision, pdf: !!c?.pdf, mcp: !!c?.mcp })

export function CapLamps({ lamps }: { lamps: Lamps }) {
  const t = useT()
  return (
    <span className="aicaps" role="img" aria-label={KEYS.map((k) => t(lamps[k] ? 'features.ai.prov.lamp.has' : 'features.ai.prov.lamp.hasNot', { what: t(`features.ai.prov.lamp.${k}`) })).join(', ')}>
      {KEYS.map((k) => (
        <i key={k} data-off={lamps[k] ? undefined : ''} title={t(lamps[k] ? 'features.ai.prov.lamp.has' : 'features.ai.prov.lamp.hasNot', { what: t(`features.ai.prov.lamp.${k}`) })}>
          {t(`features.ai.prov.lamp.k.${k}`)}
        </i>
      ))}
    </span>
  )
}
