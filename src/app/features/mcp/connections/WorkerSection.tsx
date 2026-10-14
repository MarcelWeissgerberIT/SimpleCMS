/**
 * MCP · Connections § 03 — CODING WORKER: this browser's link to the coding worker (the Preflight Worker lamp's rule and
 * clock: red exactly when the lamp is, with the time it went down), and Claude Code's own MCP servers per place as the
 * worker names them (names only — they are set on the worker's computer). While a task runs Claude Code also gets One's
 * task tools (MCP_TASK_TOOLS).
 */
import { useT } from '../../../i18n'
import { CodingChangeReposButton, codingWorkerStateText, openCodingSettings, useCoding } from '../../coding'
import { workerOutdated, workerUnsafe } from '../../coding/protocol'
import { fmtTime } from '../../preflight/format'
import { MCP_TASK_TOOLS } from '../contract'
import { alsoOnes, workerPlaces } from './model'
import { useServers, useWorkerLevel } from './hooks'
import { Chip, GoKey, Row, Section } from './parts'

export function WorkerSection() {
  const t = useT()
  const enabled = useCoding((s) => s.enabled)
  const conn = useCoding((s) => s.conn)
  const worker = useCoding((s) => s.worker)
  const busy = useCoding((s) => s.busy)
  const refused = useCoding((s) => s.refused)
  const relay = useCoding((s) => s.relay)
  const pendingHere = useCoding((s) => s.pendingHere)
  const can = useCoding((s) => s.can)
  const servers = useServers()
  const connected = enabled && conn === 'connected'
  const { level, since } = useWorkerLevel()
  const version = connected ? (worker?.worker ?? '') : ''
  const unsafe = connected && workerUnsafe(version)
  const outdated = connected && !unsafe && workerOutdated(can)
  const state = !enabled ? 'off' : conn
  // down (the lamp's red): since when, by the lamp's own clock
  const downSince = level === 'red' && since !== null ? fmtTime(since) : null
  const word = unsafe ? t('features.preflight.lamp.worker.second.unsafe') : outdated ? t('features.preflight.lamp.worker.second.outdated') : t(`features.mcp.page.wstate.${state}`)
  const places = workerPlaces(connected ? worker : null, can)
  const text = codingWorkerStateText(t, { enabled, conn, worker, busy, refused, relay, pendingHere })

  return (
    <Section n="03" code={t('features.mcp.page.worker.code')} scope={t('features.mcp.page.scope.browser')} title={t('features.mcp.page.worker.title')} note={t('features.mcp.page.worker.note')} testId="mcpc-worker">
      <ul className="mcpc-rows">
        <Row
          kind="worker"
          name={(connected && worker?.name ? worker.name : t('features.mcp.page.worker.name')).toUpperCase()}
          host={version ? `worker ${version}` : undefined}
          level={level}
          word={word}
          tone={level === 'red' || level === 'amber' ? level : undefined}
          reason={
            <>
              {enabled ? text : t('features.mcp.page.worker.offWhy')}
              {downSince && (
                <span className="mcpc-why2" data-testid="mcpc-worker-since">
                  {t('features.mcp.page.worker.downSince', { time: downSince })}
                </span>
              )}
              {unsafe && <span className="mcpc-why2">{t('features.coding.worker.unsafe', { version })}</span>}
              {outdated && <span className="mcpc-why2">{t('features.coding.worker.outdated')}</span>}
            </>
          }
          attrs={{ 'data-state': state, 'data-level': level === 'red' || level === 'amber' ? level : undefined }}
          testId="mcpc-worker-row"
          keys={
            <>
              <CodingChangeReposButton label={t('features.mcp.page.worker.setupPage')} testId="mcpc-worker-setup" />
              <GoKey label={t('features.mcp.page.worker.open')} aria={t('features.mcp.page.worker.openAria')} onClick={openCodingSettings} testId="mcpc-worker-settings" />
            </>
          }
        >
          {places.kind === 'old' && (
            <p className="mcpc-note" data-testid="mcpc-worker-old">
              {t('features.ai.mcp.ov.codeOld')}
            </p>
          )}
          {places.kind === 'unknown' && (
            <p className="mcpc-note mcpc-note--plain" data-testid="mcpc-worker-unknown">
              {t('features.ai.mcp.ov.codeUnknown')}
            </p>
          )}
          {places.kind === 'named' && (
            <div className="mcpc-places" data-testid="mcpc-worker-places">
              <span className="label">{t('features.mcp.page.worker.servers')}</span>
              <ul className="mcpc-places__list">
                {places.places.map((p) => (
                  <li key={p.repo ?? ''} className="mcpc-place" data-repo={p.repo ?? ''}>
                    <span className="mcpc-place__where">{p.repo ?? t('features.ai.mcp.ov.noRepo')}</span>
                    {p.names.length ? (
                      <ul className="mcpc-tags">
                        {p.names.map((n) => (
                          <Chip key={n} mono>
                            {n}
                            {alsoOnes(n, servers) && <span className="mcpc-tag__also">{t('features.mcp.page.worker.alsoOne')}</span>}
                          </Chip>
                        ))}
                      </ul>
                    ) : (
                      <span className="mcpc-muted">{t('features.mcp.page.worker.none')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {connected && (
            <p className="mcpc-note mcpc-note--plain" data-testid="mcpc-worker-tools">
              {t('features.mcp.page.worker.taskTools', { tools: MCP_TASK_TOOLS.map((x) => x.name).join(' · ') })}
            </p>
          )}
        </Row>
      </ul>
    </Section>
  )
}
