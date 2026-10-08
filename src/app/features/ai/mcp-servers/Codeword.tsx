/**
 * Codewords in the prompts: the chip next to the AI menu / ⌘K "?" input while a request starts with
 * a recognised codeword ("→ KB"), and the note in a result when an addressed server stayed out.
 */
import { useMemo } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { readServers } from './config'
import { parseCodewords } from './codeword'
import type { McpCall } from './activity'
import './codeword.css'

/** "→ KB" for each server the text addresses by codeword (nothing without one). */
export function CodewordChip({ text }: { text: string }) {
  const t = useT()
  const raw = useWorkspace((s) => s.settings.mcpServers)
  const servers = useMemo(() => readServers({ mcpServers: raw }), [raw])
  const hit = useMemo(() => parseCodewords(text, servers).servers, [text, servers])
  if (!hit.length) return null
  const names = hit.map((s) => s.name.toUpperCase()).join(' · ')
  return (
    <span className="mcp-cw" role="note" aria-label={t('features.ai.mcp.cw.chip', { names })} data-testid="mcp-codeword-chip">
      {hit.map((s) => (
        <span key={s.id} className="mcp-cw__chip" data-state={s.enabled ? 'on' : 'off'} title={s.enabled ? t('features.ai.mcp.cw.chip', { names: s.name.toUpperCase() }) : t('features.ai.mcp.cw.note.off', { server: s.name })}>
          <span className="mcp-cw__arrow" aria-hidden>
            →
          </span>
          {` ${s.name.toUpperCase()}`}
          {!s.enabled && <span className="mcp-cw__off">{` · ${t('features.ai.mcp.cw.tag.off')}`}</span>}
        </span>
      ))}
    </span>
  )
}

/** The short label of a skipped entry's chip ("KB · OFF"). */
export function skippedLabel(t: ReturnType<typeof useT>, c: McpCall): string {
  return `${c.server.toUpperCase()} · ${t(`features.ai.mcp.cw.tag.${c.skipped}`)}`
}

/** One line per server a codeword addressed that did not join the request (switched off, no token). */
export function McpSkippedNote({ calls }: { calls: McpCall[] }) {
  const t = useT()
  const skipped = calls.filter((c) => c.skipped)
  if (!skipped.length) return null
  return (
    <>
      {skipped.map((c) => (
        <p key={c.id} className="mcp-skip" role="note" data-testid="mcp-skipped">
          <span className="led" aria-hidden />
          <span>{t(`features.ai.mcp.cw.note.${c.skipped}`, { server: c.server })}</span>
        </p>
      ))}
    </>
  )
}
