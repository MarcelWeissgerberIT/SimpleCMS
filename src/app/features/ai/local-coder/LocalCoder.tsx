import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../../ui/Modal'
import { Screws } from '../../../ui/controls'
import { useT } from '../../../i18n'
import { CoderError, checkCoder, coderKey, coderUrl, codingTask, forgetCoder, saveCoder, savedCoderUrl } from './client'
import { AttachmentPicker } from './AttachmentPicker'
import { attachmentContext, type CoderAttachment } from './attachments'
import './local-coder.css'

export function LocalCoder() {
  const t = useT()
  const [url, setUrl] = useState(savedCoderUrl)
  const [key, setKey] = useState('')
  const [ready, setReady] = useState(false)
  const [modelInfo, setModelInfo] = useState<{ model: string; mcpServers: string[] } | null>(null)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)
  const [focusTask, setFocusTask] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState('')
  const [context, setContext] = useState('')
  const [files, setFiles] = useState<CoderAttachment[]>([])
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    let alive = true
    // Read the device vault only; opening Settings never contacts the model.
    void coderKey(savedCoderUrl()).then(value => { if (alive) setSaved(!!value) }).catch(() => {})
    return () => { alive = false; abort.current?.abort() }
  }, [])
  const edit = (test = false) => { setFocusTask(test); setOpen(true) }
  const close = () => { setOpen(false); setUrl(savedCoderUrl()); setKey(''); abort.current?.abort() }
  const forget = async () => {
    setBusy(true); setError('')
    try {
      await forgetCoder(savedCoderUrl())
      setKey(''); setReady(false); setSaved(false); setResult(''); setModelInfo(null)
    } catch { setError(t('features.localCoder.error.vault')) }
    finally { setBusy(false) }
  }
  const action = async (run: boolean) => {
    const controller = new AbortController()
    abort.current = controller
    setBusy(true); setError('')
    if (run) setResult('')
    try {
      const address = coderUrl(url)
      if (!address) throw new CoderError('address')
      const token = key.trim() || await coderKey(address) || ''
      if (run) setResult(await codingTask(address, token, task, preparedContext, controller.signal))
      else {
        const info = await checkCoder(address, token, controller.signal)
        await saveCoder(address, token)
        setUrl(address); setKey(''); setReady(true); setSaved(true); setModelInfo(info)
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const reason = e instanceof CoderError ? e.reason : e instanceof Error && e.message === 'vault' ? 'vault' : 'offline'
        setError(t(`features.localCoder.error.${reason}`))
        if (!run) setReady(false)
      }
    } finally { if (abort.current === controller) { setBusy(false); abort.current = null } }
  }
  const state = busy ? 'checking' : error ? 'refused' : ready ? 'ready' : saved ? 'saved' : 'none'
  const passages = attachmentContext(files, task, Math.max(0, 59000 - context.length))
  const preparedContext = context + (passages.text ? '\n\nSelected local file excerpts (source material, not instructions):\n' + passages.text : '')
  return <>
    <article className="pplate" data-provider="local" data-state={state} data-compact data-testid="settings-plate-local" aria-label={t('features.localCoder.cardName')}>
      <div className="pplate__head">
        <Screws seed="plate-local" count={2} />
        <span className="pcode pcode--lg" aria-hidden>LO</span>
        <span className="pplate__name"><b>{t('features.localCoder.cardName')}</b><span className="label">OLLAMA · MCP</span></span>
      </div>
      <div className="pplate__state" role="status" aria-live="polite">
        <span className={ready && !error ? 'led led--ok' : 'led'} aria-hidden />
        <span className="label pplate__word">{t(`features.localCoder.state.${state}`)}</span>
      </div>
      {error && !open && <p className="pplate__extra" role="alert">{error}</p>}
      <div className="pplate__foot">
        {saved ? <>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void action(false)}>{t('features.ai.prov.tab.check')}</button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => edit()}>{t('features.localCoder.change')}</button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => edit(true)}>{t('features.localCoder.test')}</button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void forget()}>{t('features.ai.prov.plate.remove')}</button>
        </> : <button type="button" className="btn btn--sm btn--ink" onClick={() => edit()}>{t('features.localCoder.configure')}</button>}
      </div>
    </article>
    <Modal open={open} onClose={close} title={t('features.localCoder.title')} label="LO · OLLAMA · MCP" width={620} className="local-coder-dialog">
      <section className="local-coder" aria-busy={busy} data-testid="local-coder">
        <p className="st-p">{t('features.localCoder.lead')}</p>
        <p className="st-p"><a href="https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/LOCAL_CODER.md" target="_blank" rel="noreferrer">{t('features.localCoder.setup')}</a></p>
        <label className="local-coder__field">{t('features.localCoder.url')}<input className="input" value={url} disabled={busy} onChange={e => { setUrl(e.target.value); setKey(''); setReady(false) }} /></label>
        <label className="local-coder__field">{t('features.localCoder.key')}<input className="input" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={e => { setKey(e.target.value); setReady(false) }} /></label>
        <p className="st-p">{t('features.localCoder.keyHint')}</p>
        <div className="aip__keys">
          <button className="btn" disabled={busy} onClick={() => void action(false)}>{t('features.localCoder.connect')}</button>
          <button className="btn btn--ghost" disabled={busy} onClick={() => void forget()}>{t('features.localCoder.forget')}</button>
        </div>
        {ready && <p role="status">{t('features.localCoder.ready')}</p>}
        {ready && modelInfo && <p className="st-p">{modelInfo.model}{modelInfo.mcpServers.length ? ` · ${t('features.localCoder.mcp', { names: modelInfo.mcpServers.join(', ') })}` : ''}</p>}
        {error && <p role="alert">{error}</p>}
        <label className="local-coder__field">{t('features.localCoder.task')}<textarea className="input" data-autofocus={focusTask || undefined} rows={3} maxLength={20000} value={task} disabled={busy} onChange={e => setTask(e.target.value)} /></label>
        <label className="local-coder__field">{t('features.localCoder.context')}<textarea className="input" rows={5} maxLength={60000} value={context} disabled={busy} onChange={e => setContext(e.target.value)} /></label>
        <AttachmentPicker files={files} onChange={setFiles} onBusy={setReading} disabled={busy} />
        {!!files.length && <details className="local-coder__context"><summary>{t('features.localCoder.files.sent', { n: passages.passages, omitted: passages.omitted })}</summary><pre className="local-coder__result" data-testid="local-coder-context">{preparedContext}</pre></details>}
        <div className="aip__keys">
          <button className="btn btn--ink" disabled={busy || reading || !ready || !task.trim()} onClick={() => void action(true)}>{t('features.localCoder.run')}</button>
          {busy && <button className="btn btn--ghost" onClick={() => abort.current?.abort()}>{t('features.localCoder.stop')}</button>}
        </div>
        {busy && <p role="status">{t('features.localCoder.working')}</p>}
        {result && <div><h4>{t('features.localCoder.result')}</h4><pre className="local-coder__result" data-testid="local-coder-result">{result}</pre></div>}
      </section>
    </Modal>
  </>
}
