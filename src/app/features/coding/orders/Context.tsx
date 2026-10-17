/**
 * Work orders — the picked server's part on the plate (spec §1.4 / §1.5): the planner's summary of what the server
 * returned ("Kontext · Zusammenfassung des Planers", tagged FREMD, "geht in Schritt 01 mit" — it is written into step
 * 01's page), every call it made ("<Server> · <Werkzeug>(<Argumente>) → 3,2 kB"; "Server lieferte nichts"), the tools it
 * could call and the ones left out with their reason — or, when the picked server stayed out, why ("ohne Server: …";
 * a server never tested here offers "Server testen"). The server is only ever the person's own name for it.
 */
import type { ReactNode } from 'react'
import { useLang, useT } from '../../../i18n'
import { readServers } from '../../ai/mcp-servers/config'
import { serverReturnedNothing } from './calls'
import type { OrderCall, OrderDraft, OrderServerSkip, OrderToolLeft } from './types'

const O = 'features.coding.order'
const P = 'features.coding.order.planner'

/** "3,2 kB" · "820 B" in the UI's number format. */
export function sizeText(bytes: number, lang: string): string {
  const loc = lang === 'de' ? 'de-DE' : 'en-US'
  if (bytes < 1000) return `${new Intl.NumberFormat(loc).format(bytes)} B`
  return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(bytes / 1000)} kB`
}

/** Every call the planner made on the server, one line each; "Server lieferte nichts" when nothing came back. */
export function CallList({ server, calls, done }: { server: string; calls: readonly OrderCall[]; done: boolean }) {
  const t = useT()
  const lang = useLang()
  return (
    <ul className="orc-calls" aria-label={t(`${O}.plan.calls`, { server })} data-testid="order-calls">
      {calls.map((c, i) => (
        <li key={i} className="orc-call" data-ok={c.ok ? '' : undefined} data-testid="order-call">
          {t(`${P}.line.call`, { server, tool: c.tool, args: c.args, size: sizeText(c.bytes, lang) })}
          {!c.ok && <span className="label orc-call__fail"> {t(`${O}.plan.callFailed`)}</span>}
        </li>
      ))}
      {done && serverReturnedNothing(calls) && (
        <li className="orc-call" data-testid="order-call-nothing">
          {t(`${P}.line.nothing`)}
        </li>
      )}
    </ul>
  )
}

/** The tools the planner could call ("liest: …") and the ones left out with their reason ("nicht dabei: …"). */
export function ToolLines({ tools, left }: { tools: readonly string[]; left: ReadonlyArray<{ tool: string; why: OrderToolLeft }> }) {
  const t = useT()
  return (
    <>
      {tools.length > 0 && <p className="orc-line orc-line--quiet" data-testid="order-tools-read">{t(`${O}.plan.reads`, { list: tools.join(', ') })}</p>}
      {left.length > 0 && (
        <p className="orc-line orc-line--quiet" data-testid="order-tools-left">
          {t(`${O}.plan.left`, { list: left.map((l) => `${l.tool} (${t(`${P}.left.${l.why}`)})`).join(', ') })}
        </p>
      )}
    </>
  )
}

/** Why the picked server stayed out of a plan, and "Server testen" for one never tested here. */
export function SkipLine({ draft, skip }: { draft?: OrderDraft; skip?: { server: string; why: OrderServerSkip } | null }) {
  const t = useT()
  const s = skip ?? draft?.source.skip ?? null
  if (!s) return null
  return (
    <p className="orc-line orc-line--quiet orc-skip" data-testid="order-skip">
      {t(`${P}.skip.${s.why}`, { server: s.server })}
      {s.why === 'untested' && (
        <>
          {' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void import('../../mcp').then((m) => m.openMcpConnections({ server: idOfServer(s.server), focus: 'test' }))} data-testid="order-test-server">
            {t(`${O}.plan.testServer`)}
          </button>
        </>
      )}
    </p>
  )
}

/** The id of this device's server of that name (MCP · Connections opens its row by id). */
const idOfServer = (name: string): string | undefined => readServers().find((x) => x.name === name)?.id

/** The cut-out "Kontext · Zusammenfassung des Planers" (FREMD) with the call list and the tools. */
export function ContextBox({ draft, goesWith, edges, end }: { draft: OrderDraft; goesWith: string; edges?: ReactNode; end?: ReactNode }) {
  const t = useT()
  const ctx = draft.plan.context
  const server = draft.source.server
  if (!ctx || !server) return null
  return (
    <section className="orc-context" aria-label={t(`${O}.plan.context`)} data-testid="order-context">
      {edges}
      <p className="orc-context__head">
        <span className="label">{t(`${O}.plan.context`)}</span>
        <span className="label orc-tag" data-tag="foreign">
          {t(`${O}.plan.foreign`)}
        </span>
        <span className="label orc-context__goes">{t(`${O}.plan.goesWith`, { n: goesWith })}</span>
      </p>
      <p className="orc-context__note">{ctx.note}</p>
      {ctx.links.length > 0 && (
        <ul className="orc-context__links">
          {ctx.links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noopener noreferrer nofollow">
                {l}
              </a>
            </li>
          ))}
        </ul>
      )}
      <CallList server={server} calls={draft.source.calls} done />
      <ToolLines tools={draft.source.tools} left={draft.source.left} />
      {end}
    </section>
  )
}
