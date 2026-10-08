/**
 * Settings → Claude AI → MCP servers: the overview table — per server its codeword and where it may be used: One's
 * own Claude (scope / switched off), the custom agents that attach it, the integration profiles it activates and
 * Claude Code in the coding worker (a server of the same name or codeword there; per repo and for tasks without a
 * repo). Rows come from overview.ts; a server name opens its details below. At phone width each row is a card.
 */
import { useId, useMemo } from 'react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { McpServerConfig } from '../../../store/types'
import { useCoding } from '../../coding'
import { overviewRows, type CodeUse, type OverviewRow } from './overview'

type T = ReturnType<typeof useT>

export function McpOverview({ servers, onShow }: { servers: McpServerConfig[]; onShow: (id: string) => void }) {
  const t = useT()
  const headId = useId()
  const agents = useWorkspace((s) => s.agents)
  const profiles = useWorkspace((s) => s.integrations)
  const worker = useCoding((s) => (s.enabled && s.conn === 'connected' ? s.worker : null))
  const can = useCoding((s) => s.can)
  const rows = useMemo(
    () => overviewRows(servers, Object.values(agents ?? {}), profiles ?? [], worker ? { repos: worker.repos, mcp: worker.mcp, named: !!can?.includes('mcp-list') } : null),
    [servers, agents, profiles, worker, can],
  )
  if (!rows.length) return null
  const withProfiles = (profiles?.length ?? 0) > 0
  return (
    <section className="mcpo" aria-labelledby={headId} data-testid="mcp-overview">
      <span className="label mcpo__code" id={headId}>
        {t('features.ai.mcp.ov.title')}
      </span>
      <div className="mcpo__wrap">
        <table className="mcpo__table">
          <thead>
            <tr>
              <th scope="col">{t('features.ai.mcp.ov.server')}</th>
              <th scope="col">{t('features.ai.mcp.ov.codeword')}</th>
              <th scope="col">{t('features.ai.mcp.ov.one')}</th>
              <th scope="col">{t('features.ai.mcp.ov.agents')}</th>
              {withProfiles && <th scope="col">{t('features.ai.mcp.ov.integrations')}</th>}
              <th scope="col">{t('features.ai.mcp.ov.code')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.key} row={r} withProfiles={withProfiles} onShow={onShow} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mcpo__note">{t('features.ai.mcp.ov.note')}</p>
    </section>
  )
}

function Row({ row: r, withProfiles, onShow }: { row: OverviewRow; withProfiles: boolean; onShow: (id: string) => void }) {
  const t = useT()
  const dash = <span className="mcpo__none">—</span>
  return (
    <tr data-server={r.name} data-only={r.server ? undefined : 'code'}>
      <th scope="row" className="mcpo__name" data-label={t('features.ai.mcp.ov.server')}>
        <span className="mcpo__name-in">
          <span className={r.one === 'all' || r.one === 'free' ? 'led led--ok' : 'led'} aria-hidden />
          <span className="mcpo__id">
            {r.server ? (
              <button type="button" className="mcpo__link" onClick={() => onShow(r.server!.id)} title={t('features.ai.mcp.ov.open')}>
                {r.name.toUpperCase()}
              </button>
            ) : (
              <span className="mcpo__plain">{r.name}</span>
            )}
            <span className="mcpo__host">{r.server ? r.host : t('features.ai.mcp.ov.onlyCode')}</span>
          </span>
        </span>
      </th>
      <td data-label={t('features.ai.mcp.ov.codeword')}>{r.codeword ? <code className="mcpo__cw">{r.codeword}:</code> : dash}</td>
      <td data-label={t('features.ai.mcp.ov.one')} data-state={r.one ?? 'none'}>
        {r.one === null ? (
          dash
        ) : (
          <span className="mcpo__scope" title={t(`features.ai.mcp.ov.scope.${r.one}Long`)}>
            {t(`features.ai.mcp.ov.scope.${r.one}`)}
          </span>
        )}
      </td>
      <td data-label={t('features.ai.mcp.ov.agents')}>
        {r.agents.length ? (
          <ul className="mcpo__chips">
            {r.agents.map((a) => (
              <li key={a.id} className="mcpo__chip" data-off={a.enabled ? undefined : ''} title={a.enabled ? undefined : t('features.ai.mcp.ov.agentOff')}>
                {a.name}
                {a.tools !== null && <span className="mcpo__sub">{t(a.tools === 1 ? 'features.ai.mcp.ov.tools.one' : 'features.ai.mcp.ov.tools.other', { count: a.tools })}</span>}
              </li>
            ))}
          </ul>
        ) : (
          dash
        )}
      </td>
      {withProfiles && (
        <td data-label={t('features.ai.mcp.ov.integrations')}>
          {r.integrations.length ? (
            <ul className="mcpo__chips">
              {r.integrations.map((n) => (
                <li key={n} className="mcpo__chip">
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            dash
          )}
        </td>
      )}
      <td data-label={t('features.ai.mcp.ov.code')} data-testid="mcp-overview-code">
        <Code use={r.code} t={t} />
      </td>
    </tr>
  )
}

function Code({ use, t }: { use: CodeUse; t: T }) {
  if (use.kind === 'none') return <span className="mcpo__muted">{t('features.ai.mcp.ov.codeOff')}</span>
  if (use.kind === 'old') return <span className="mcpo__muted">{t('features.ai.mcp.ov.codeOld')}</span>
  if (!use.repos.length && !use.noRepo) return <span className="mcpo__none">—</span>
  return (
    <ul className="mcpo__chips">
      {use.repos.map((r) => (
        <li key={r} className="mcpo__chip mcpo__chip--repo">
          {r}
        </li>
      ))}
      {use.noRepo && <li className="mcpo__chip mcpo__chip--repo">{t('features.ai.mcp.ov.noRepo')}</li>}
    </ul>
  )
}
