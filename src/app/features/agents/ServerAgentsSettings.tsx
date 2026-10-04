/**
 * Settings → Agents · MCP → "Server agents" (team workspaces): the team server's agent runtime. Admins
 * set the server's Claude key and its MCP servers (secrets go to the server, encrypted with the
 * workspace key, and never come back — only "set · last 4") and switch the runner on or off. Members
 * see the state. An older server without the endpoints: "does not support agents yet".
 */
import { useEffect, useId, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCloud } from '../../cloud'
import { useUI } from '../../store/ui'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { urlProblem, slugName } from '../ai/mcp-servers/config'
import { loadRuntime, saveRuntime, useServerAgents, type SecretState } from './server'
import './agents.css'

function SecretRead({ s }: { s: SecretState }) {
  const t = useT()
  return s.set ? (
    <span className="agx-secret mono">
      <span className="led led--ok" aria-hidden /> {t('features.agents.srv.set')}
      {s.last4 ? ` · ••••${s.last4}` : ''}
    </span>
  ) : (
    <span className="agx-secret mono">
      <span className="led" aria-hidden /> {t('features.agents.srv.notSet')}
    </span>
  )
}

export function ServerAgentsSettings() {
  const t = useT()
  const inCloud = useCloud((s) => s.active.kind === 'cloud')
  const role = useCloud((s) => s.role)
  const admin = role === 'owner' || role === 'admin'
  const state = useServerAgents((s) => s.state)
  const runtime = useServerAgents((s) => s.runtime)
  const error = useServerAgents((s) => s.error)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Array<{ name: string; url: string; token: string; tokenState?: SecretState }>>([])
  const [dirty, setDirty] = useState(false)
  const uid = useId()

  useEffect(() => {
    if (inCloud) void loadRuntime()
  }, [inCloud])
  useEffect(() => {
    if (runtime && !dirty) setRows(runtime.mcpServers.map((s) => ({ name: s.name, url: s.url, token: '', tokenState: s.token })))
  }, [runtime, dirty])

  if (!inCloud) return null

  const put = async (patch: Parameters<typeof saveRuntime>[0], done: string) => {
    setBusy(true)
    try {
      await saveRuntime(patch)
      useUI.getState().toast({ message: done, kind: 'success' })
      return true
    } catch (e) {
      useUI.getState().toast({ message: t('features.agents.srv.saveFailed', { msg: e instanceof Error ? e.message : String(e) }), kind: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const badRow = rows.find((r) => !r.name || urlProblem(r.url) || rows.filter((x) => x.name === r.name).length > 1)

  return (
    <section className="agx-srv" aria-labelledby={`${uid}-h`}>
      <h3 className="st-h agx-srv__h" id={`${uid}-h`}>
        <span className="label agx-srv__code">§ AG-S</span> {t('features.agents.srv.title')}
      </h3>
      <p className="st-p">{t('features.agents.srv.lead')}</p>
      <dl className="agx-srv__compare">
        <div>
          <dt className="label">{t('features.agents.runner.browser')}</dt>
          <dd>{t('features.agents.runner.browserHint')}</dd>
        </div>
        <div>
          <dt className="label">{t('features.agents.runner.server')}</dt>
          <dd>{t('features.agents.runner.serverHint')}</dd>
        </div>
      </dl>
      {state === 'loading' && !runtime && <p className="agx-note label">{t('features.agents.srv.loading')}</p>}
      {state === 'unsupported' && (
        <p className="agx-notice" role="note">
          <span className="led" aria-hidden /> {t('features.agents.server.unsupported')}
        </p>
      )}
      {state === 'forbidden' && (
        <p className="agx-notice" role="note">
          <span className="led" aria-hidden /> {t('features.agents.server.forbidden')}
        </p>
      )}
      {runtime && !runtime.available && (
        <p className="agx-notice" role="note" data-testid="agx-server-off">
          <span className="led agx-led--err" aria-hidden /> {t('features.agents.server.off')}
        </p>
      )}
      {state === 'error' && (
        <p className="agx-notice" role="alert">
          <span className="led agx-led--err" aria-hidden /> {t('features.agents.srv.loadFailed', { msg: error ?? '' })}
          <button type="button" className="btn btn--sm" onClick={() => void loadRuntime()}>
            <RotateCcw size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.srv.retry')}
          </button>
        </p>
      )}
      {runtime && (
        <div className="agx-srv__body">
          {!admin && <p className="agx-note">{t('features.agents.srv.adminsOnly')}</p>}
          <div className="agx-srv__row">
            <span className="agx-srv__label">{t('features.agents.srv.enabled')}</span>
            <span className="agx-secret mono">
              <span className={runtime.enabled ? 'led led--ok' : 'led'} aria-hidden /> {runtime.enabled ? t('features.agents.srv.on') : t('features.agents.srv.off')}
            </span>
            <span className="agx-spacer" />
            {admin && <Switch checked={runtime.enabled} disabled={busy || (!runtime.enabled && !runtime.claudeKey.set)} onChange={(enabled) => void put({ enabled }, enabled ? t('features.agents.srv.turnedOn') : t('features.agents.srv.turnedOff'))} label={t('features.agents.srv.enabled')} />}
          </div>
          {admin && !runtime.claudeKey.set && !runtime.enabled && <p className="agx-field__hint">{t('features.agents.srv.needsKey')}</p>}

          <div className="agx-srv__row">
            <label className="agx-srv__label" htmlFor={`${uid}-key`}>
              {t('features.agents.srv.key')}
            </label>
            <SecretRead s={runtime.claudeKey} />
          </div>
          {admin && (
            <form
              className="agx-srv__keyform"
              onSubmit={(e) => {
                e.preventDefault()
                if (!key.trim()) return
                void put({ claudeKey: key.trim() }, t('features.agents.srv.keySaved')).then((ok) => ok && setKey(''))
              }}
            >
              <input id={`${uid}-key`} className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
              <button type="submit" className="btn btn--sm btn--ink" disabled={busy || !key.trim()}>
                {t('features.agents.srv.saveKey')}
              </button>
              {runtime.claudeKey.set && (
                <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void put({ claudeKey: null }, t('features.agents.srv.keyRemoved'))}>
                  {t('features.agents.srv.removeKey')}
                </button>
              )}
            </form>
          )}

          <div className="agx-srv__mcp">
            <span className="agx-srv__label">{t('features.agents.srv.mcp')}</span>
            {rows.length === 0 && <p className="agx-field__hint">{t('features.agents.srv.mcpNone')}</p>}
            <ul className="agx-srv__list">
              {rows.map((r, i) => (
                <li key={i} className="agx-srv__item">
                  {admin ? (
                    <>
                      <input className="input mono" aria-label={t('features.agents.srv.mcpName')} placeholder="atlas" value={r.name} onChange={(e) => (setDirty(true), setRows(rows.map((x, j) => (j === i ? { ...x, name: slugName(e.target.value) } : x))))} />
                      <input className="input mono" aria-label={t('features.agents.srv.mcpUrl')} placeholder="https://…/mcp" value={r.url} onChange={(e) => (setDirty(true), setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))))} />
                      <input
                        className="input mono"
                        type="password"
                        autoComplete="off"
                        aria-label={t('features.agents.srv.mcpToken')}
                        placeholder={r.tokenState?.set ? `••••${r.tokenState.last4 ?? ''}` : t('features.agents.srv.mcpTokenPh')}
                        value={r.token}
                        onChange={(e) => (setDirty(true), setRows(rows.map((x, j) => (j === i ? { ...x, token: e.target.value } : x))))}
                      />
                      <button type="button" className="icon-btn icon-btn--sm" aria-label={t('features.agents.srv.mcpRemove', { name: r.name || '—' })} onClick={() => (setDirty(true), setRows(rows.filter((_, j) => j !== i)))}>
                        <Trash2 size={13} strokeWidth={1.7} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="mono">{r.name.toUpperCase()}</span>
                      <span className="agx-srv__url mono faint">{r.url}</span>
                      {r.tokenState && <SecretRead s={r.tokenState} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {admin && (
              <div className="agx-row">
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => (setDirty(true), setRows([...rows, { name: '', url: '', token: '' }]))}>
                  <Plus size={13} strokeWidth={1.8} aria-hidden /> {t('features.agents.srv.mcpAdd')}
                </button>
                <span className="agx-spacer" />
                {dirty && (
                  <>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDirty(false)}>
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={busy || !!badRow}
                      title={badRow ? t('features.agents.srv.mcpInvalid') : undefined}
                      onClick={() =>
                        void put({ mcpServers: rows.map((r) => ({ name: r.name, url: r.url.trim(), ...(r.token.trim() ? { token: r.token.trim() } : {}) })) }, t('features.agents.srv.mcpSaved')).then((ok) => ok && setDirty(false))
                      }
                    >
                      {t('features.agents.srv.mcpSave')}
                    </button>
                  </>
                )}
              </div>
            )}
            {admin && dirty && badRow && <p className="agx-field__error">{t('features.agents.srv.mcpInvalid')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
