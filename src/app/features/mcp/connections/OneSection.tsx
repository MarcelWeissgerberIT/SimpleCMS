/**
 * MCP · Connections § 01 — ONE'S CLAUDE: one row per MCP server of this device (Settings › AI › MCP servers, in its
 * order). The LED is the Preflight Token lamp's rule (tokenTrouble); the facts come from the Settings overview table's
 * own model (overviewRows). Keys: Test (the existing connection test — one short Claude request, only on a press),
 * Sign in on a red row (the existing OAuth keys; a device code shows right here), Settings ↗ (that server's card).
 * Never a token: presence is the vault marker's presence; "token missing in this browser" stays in Settings.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { McpServerConfig } from '../../../store/types'
import { useCoding } from '../../coding'
import { readServers, refusedHere } from '../../ai/mcp-servers/config'
import { checkServer, useMcpChecks } from '../../ai/mcp-servers/checks'
import { signedIn, useMcpSignIn } from '../../ai/mcp-servers/oauth'
import { overviewRows, workerNames, type CodeUse, type OverviewRow } from '../../ai/mcp-servers/overview'
import { DeviceCode, SignInKeys } from '../../ai/mcp-servers/SignIn'
import { AINeedsSetup, offersAI, useAIStatus } from '../../ai/setup/AINeedsSetup'
import { openAISettings } from '../../ai/setup/openAISetup'
import { hostOnly, ledOf, missingNamed, serverState, type ServerState } from './model'
import { useAgentsHere, useNow, useRefusedRev, useServers } from './hooks'
import { Chip, Facts, GoKey, Row, Section, useAnnounce } from './parts'

type T = ReturnType<typeof useT>

const when = (ms: number) => format(ms, 'yyyy-MM-dd HH:mm')

const WORD: Record<ServerState, string> = {
  off: 'off',
  untested: 'untested',
  ok: 'ok',
  refusedTest: 'refused',
  refusedTab: 'refused',
  expired: 'expired',
  failed: 'failed',
}

export function OneSection() {
  const t = useT()
  const servers = useServers()
  // only the agents whose runs happen in this browser (a team: the member's own) — another member's run elsewhere
  const agents = useAgentsHere()
  const profiles = useWorkspace((s) => s.integrations)
  const worker = useCoding((s) => (s.enabled && s.conn === 'connected' ? s.worker : null))
  const can = useCoding((s) => s.can)
  useRefusedRev()
  const now = useNow()
  const canTest = offersAI(useAIStatus('mcp-setup.inspect'))
  const rows = useMemo(
    () => overviewRows(servers, agents, profiles ?? [], worker ? { repos: worker.repos, mcp: worker.mcp, named: workerNames(worker, can) } : null),
    [servers, agents, profiles, worker, can],
  )
  const missing = useMemo(() => missingNamed(agents, servers), [agents, servers])
  const byId = new Map(rows.flatMap((r) => (r.server ? [[r.server.id, r] as const] : [])))
  const withProfiles = (profiles?.length ?? 0) > 0
  return (
    <Section n="01" code={t('features.mcp.page.one.code')} scope={t('features.mcp.page.scope.device')} count={servers.length} title={t('features.mcp.page.one.title')} note={t('features.mcp.page.one.note')} testId="mcpc-one">
      {servers.length > 0 ? (
        <ul className="mcpc-rows">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} row={byId.get(s.id)} now={now} canTest={canTest} withProfiles={withProfiles} />
          ))}
        </ul>
      ) : (
        <div className="mcpc-empty" data-testid="mcpc-one-empty">
          <p>{t('features.mcp.page.one.empty')}</p>
          <button type="button" className="btn btn--sm" onClick={() => openAISettings({ section: 'mcp', add: true })} data-testid="mcpc-add">
            <Plus size={13} strokeWidth={1.75} aria-hidden /> {t('features.mcp.page.one.add')}
          </button>
          {!canTest && <AINeedsSetup purpose="mcp-setup.inspect" variant="line" testId="mcpc-needs" />}
        </div>
      )}
      {missing.length > 0 && (
        <p className="mcpc-missing" role="note" data-testid="mcpc-missing">
          {t(missing.length === 1 ? 'features.mcp.page.one.missing.one' : 'features.mcp.page.one.missing.other', { list: missing.map((m) => `${m.name} (${m.agents.join(', ')})`).join(' · ') })}
        </p>
      )}
    </Section>
  )
}

function ServerRow({ server: s, row, now, canTest, withProfiles }: { server: McpServerConfig; row: OverviewRow | undefined; now: number; canTest: boolean; withProfiles: boolean }) {
  const t = useT()
  const announce = useAnnounce()
  const running = useMcpChecks((x) => x.running[s.id])
  const st = useMcpSignIn((x) => x.byServer[s.id])
  const state = serverState(s, now, refusedHere(s))
  const level = ledOf(state)
  const signing = st?.phase === 'working' || st?.phase === 'waiting' || st?.phase === 'code'
  const red = level === 'red'
  // a sign-in started from this row: its outcome goes to the page's live region
  const started = useRef(false)
  const phase = st?.phase
  useEffect(() => {
    if (!started.current) return
    if (phase === 'done') {
      started.current = false
      announce(t('features.mcp.page.live.signedIn', { name: s.name }))
    } else if (!phase || phase === 'error') started.current = false
  }, [phase, announce, t, s.name])

  const test = () => {
    if (running || signing) return
    const name = s.name
    const done = checkServer(s.id, 'test')
    // nothing started (no key here, the server gone): nothing to announce
    if (!useMcpChecks.getState().running[s.id]) return
    void done.then(() => {
      // another check took over (a sign-in's own test): that one ends the story
      if (useMcpChecks.getState().running[s.id]) return
      const now = readServers().find((x) => x.id === s.id)
      if (!now) return
      announce(t(now.checkAuth ? 'features.mcp.page.live.refused' : now.checkError ? 'features.mcp.page.live.failed' : 'features.mcp.page.live.ok', { name }))
    })
  }

  const facts = [
    row?.one ? { key: 'one', label: t('features.ai.mcp.ov.one'), value: <span title={t(`features.ai.mcp.ov.scope.${row.one}Long`)}>{t(`features.ai.mcp.ov.scope.${row.one}`)}</span> } : null,
    s.codeword ? { key: 'codeword', label: t('features.ai.mcp.ov.codeword'), value: <code className="mcpc-code">{s.codeword}:</code> } : null,
    { key: 'access', label: t('features.mcp.page.f.access'), value: access(t, s, now), testId: 'mcpc-access' },
    row && row.agents.length > 0
      ? {
          key: 'agents',
          label: t('features.ai.mcp.ov.agents'),
          value: (
            <ul className="mcpc-tags">
              {row.agents.map((a) => (
                <Chip key={a.id} off={!a.enabled} title={a.enabled ? undefined : t('features.ai.mcp.ov.agentOff')}>
                  {a.name}
                  {a.tools !== null && <span className="mcpc-tag__sub">{t(a.tools === 1 ? 'features.ai.mcp.ov.tools.one' : 'features.ai.mcp.ov.tools.other', { count: a.tools })}</span>}
                </Chip>
              ))}
            </ul>
          ),
        }
      : null,
    row && withProfiles
      ? {
          key: 'integrations',
          label: t('features.ai.mcp.ov.integrations'),
          value: row.integrations.length ? (
            <ul className="mcpc-tags">
              {row.integrations.map((n) => (
                <Chip key={n}>{n}</Chip>
              ))}
            </ul>
          ) : (
            '—'
          ),
        }
      : null,
    row && row.out.length > 0
      ? {
          key: 'out',
          label: t('features.ai.mcp.ov.out'),
          value: (
            <span className="mcpc-out" title={row.out.join(', ')}>
              <span aria-hidden>{t('features.ai.mcp.ov.outCount', { n: row.out.length })}</span>
              <span className="visually-hidden">{t('features.ai.mcp.ov.outTools', { n: row.out.length, tools: row.out.join(', ') })}</span>
            </span>
          ),
        }
      : null,
    row ? { key: 'code', label: t('features.ai.mcp.ov.code'), value: <CodeFact use={row.code} t={t} /> } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null)

  return (
    <Row
      kind="one"
      name={s.name.toUpperCase()}
      host={hostOnly(s.url)}
      level={level}
      live={!!running}
      word={running ? t('features.mcp.page.state.testing') : t(`features.mcp.page.state.${WORD[state]}`)}
      tone={level === 'red' || level === 'amber' ? level : undefined}
      reason={<Reason t={t} s={s} state={state} canTest={canTest} />}
      attrs={{ 'data-server': s.name, 'data-id': s.id, 'data-state': state, 'data-level': level === 'red' || level === 'amber' ? level : undefined }}
      keys={
        <>
          {canTest && (
            <button
              type="button"
              className="btn btn--sm mcpc-test"
              aria-disabled={running || signing ? 'true' : undefined}
              onClick={test}
              aria-label={t('features.mcp.page.testAria', { name: s.name })}
              title={t('features.mcp.page.testHint')}
              data-testid="mcpc-test"
            >
              {running ? t('features.mcp.page.state.testing') : t('features.mcp.page.test')}
            </button>
          )}
          {red && (
            <span className="mcpc-signin" role="group" aria-label={`${t('features.ai.mcp.oauth.signIn')} — ${s.name}`} onClickCapture={() => (started.current = true)}>
              <SignInKeys server={s} st={st} testId="mcpc-signin" />
            </span>
          )}
          <GoKey label={t('features.mcp.page.settings')} aria={t('features.mcp.page.settingsAria', { name: s.name })} onClick={() => openAISettings({ section: 'mcp', server: s.id })} testId="mcpc-settings" />
        </>
      }
      facts={<Facts items={facts} />}
    >
      {st?.phase === 'code' && <DeviceCode server={s} st={st} />}
      {st?.phase === 'error' && st.issue && (
        <p className="mcpc-err" role="alert" data-testid="mcpc-signin-error">
          {t(`features.ai.mcp.oauth.err.${st.issue}`, { detail: st.detail ?? '' })}
        </p>
      )}
    </Row>
  )
}

/**
 * ACCESS: signed in (and when it renews / runs out) · the sign-in ran out · a token set · none — never the token, never
 * its last 4, and no claim that this browser holds its copy (only Settings opens the vault to tell).
 */
function access(t: T, s: McpServerConfig, now: number): string {
  // ran out and cannot renew itself: the row's own clock says so (tokenTrouble 'expired')
  if (s.oauth?.expiresAt && s.oauth.expiresAt < now && !s.oauth.refresh) return t('features.mcp.page.auth.expired', { time: when(s.oauth.expiresAt) })
  if (signedIn(s) && s.oauth) {
    const until = s.oauth.expiresAt ? ` · ${t(s.oauth.refresh ? 'features.ai.mcp.oauth.renews' : 'features.ai.mcp.oauth.expires', { time: when(s.oauth.expiresAt) })}` : ''
    return `${t('features.ai.mcp.oauth.signedInShort')}${until}`
  }
  return s.token ? t('features.mcp.page.auth.token') : t('features.mcp.page.auth.none')
}

function Reason({ t, s, state, canTest }: { t: T; s: McpServerConfig; state: ServerState; canTest: boolean }) {
  let text: ReactNode
  switch (state) {
    case 'off':
      text = t('features.ai.mcp.ov.scope.offLong')
      break
    case 'untested':
      return (
        <>
          {t('features.mcp.page.why.untested')}
          {!canTest && (
            <span className="mcpc-why2">
              <AINeedsSetup purpose="mcp-setup.inspect" variant="line" testId="mcpc-needs-row" />
            </span>
          )}
        </>
      )
    case 'ok': {
      const at = when(s.checkedAt ?? 0)
      const n = s.tools?.length
      text = n === undefined ? t('features.mcp.page.why.tested', { time: at }) : n === 0 ? t('features.mcp.page.why.noTools', { time: at }) : t(n === 1 ? 'features.mcp.page.why.ok.one' : 'features.mcp.page.why.ok.other', { time: at, count: n })
      break
    }
    case 'refusedTest':
      text = t('features.mcp.page.why.refusedTest')
      break
    case 'refusedTab':
      text = t('features.mcp.page.why.refusedTab')
      break
    case 'expired':
      text = t('features.mcp.page.why.expired', { time: when(s.oauth?.expiresAt ?? 0) })
      break
    case 'failed':
      text = t('features.mcp.page.why.failed', { error: s.checkError ?? '' })
      break
  }
  return <>{text}</>
}

/** CLAUDE CODE: where the worker's Claude Code has a server of this name / codeword (the overview's CodeUse). */
function CodeFact({ use, t }: { use: CodeUse; t: T }) {
  if (use.kind === 'none') return <span className="mcpc-muted">{t('features.ai.mcp.ov.codeOff')}</span>
  if (use.kind === 'old') return <span className="mcpc-muted">{t('features.ai.mcp.ov.codeOld')}</span>
  if (use.kind === 'unknown') return <span className="mcpc-muted">{t('features.ai.mcp.ov.codeUnknown')}</span>
  if (!use.repos.length && !use.noRepo) return <>—</>
  return (
    <ul className="mcpc-tags">
      {use.repos.map((r) => (
        <Chip key={r} mono>
          {r}
        </Chip>
      ))}
      {use.noRepo && <Chip>{t('features.ai.mcp.ov.noRepo')}</Chip>}
    </ul>
  )
}
