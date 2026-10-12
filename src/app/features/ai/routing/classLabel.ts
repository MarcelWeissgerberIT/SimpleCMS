/**
 * A kind of work's name (features.ai.prov.class.*) — ONE mapping for every surface: 'generate' and 'mcp-setup' share the
 * row "MCP tests & media". Its own module (no picker, no cmdk) so the boot-path card and the assistant read it too.
 */
import type { FeatureClass } from '@/shared/ai/types'

type T = (key: string, vars?: Record<string, string | number>) => string

/** The label row a kind of work belongs to ('mcp' for generate / mcp-setup). */
export const classRow = (cls: FeatureClass): string => (cls === 'generate' || cls === 'mcp-setup' ? 'mcp' : cls)

export const classLabel = (t: T, cls: FeatureClass): string => t(`features.ai.prov.class.${classRow(cls)}`)
