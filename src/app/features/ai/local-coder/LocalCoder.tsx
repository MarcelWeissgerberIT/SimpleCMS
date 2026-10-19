import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { CoderError, checkCoder, coderKey, coderUrl, codingTask, forgetCoder, saveCoder, savedCoderUrl } from './client'
import './local-coder.css'

export function LocalCoder() {
  const t = useT()
  const [url, setUrl] = useState(savedCoderUrl)
  const [key, setKey] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState('')
  const [context, setContext] = useState('')
  const [result, setResult] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const action = async (run: boolean) => {
    const controller = new AbortController()
    abort.current = controller
    setBusy(true); setError('')
    if (run) setResult('')
    try {
      const address = coderUrl(url)
      if (!address) throw new CoderError('address')
      const token = key.trim() || await coderKey(address) || ''
      if (run) setResult(await codingTask(address, token, task, context, controller.signal))
      else {
        await checkCoder(address, token, controller.signal)
        await saveCoder(address, token)
        setUrl(address); setKey(''); setReady(true)
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const reason = e instanceof CoderError ? e.reason : e instanceof Error && e.message === 'vault' ? 'vault' : 'offline'
        setError(t(`features.localCoder.error.${reason}`))
        if (!run) setReady(false)
      }
    } finally { if (abort.current === controller) { setBusy(false); abort.current = null } }
  }
  return <section className="aip__section local-coder" aria-labelledby="local-coder-title" aria-busy={busy} data-testid="local-coder">
    <h4 className="aip__h" id="local-coder-title">{t('features.localCoder.title')}</h4>
    <p className="st-p">{t('features.localCoder.lead')}</p>
    <p className="st-p"><a href="https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/LOCAL_CODER.md" target="_blank" rel="noreferrer">{t('features.localCoder.setup')}</a></p>
    <label className="local-coder__field">{t('features.localCoder.url')}<input className="input" value={url} disabled={busy} onChange={e => { setUrl(e.target.value); setKey(''); setReady(false) }} /></label>
    <label className="local-coder__field">{t('features.localCoder.key')}<input className="input" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={e => { setKey(e.target.value); setReady(false) }} /></label>
    <p className="st-p">{t('features.localCoder.keyHint')}</p>
    <div className="aip__keys">
      <button className="btn" disabled={busy} onClick={() => void action(false)}>{t('features.localCoder.connect')}</button>
      <button className="btn btn--ghost" disabled={busy} onClick={() => { void forgetCoder(savedCoderUrl()).then(() => { setKey(''); setReady(false); setError(''); setResult('') }) }}>{t('features.localCoder.forget')}</button>
    </div>
    {ready && <p role="status">{t('features.localCoder.ready')}</p>}
    {error && <p role="alert">{error}</p>}
    <label className="local-coder__field">{t('features.localCoder.task')}<textarea className="input" rows={3} maxLength={20000} value={task} disabled={busy} onChange={e => setTask(e.target.value)} /></label>
    <label className="local-coder__field">{t('features.localCoder.context')}<textarea className="input" rows={5} maxLength={60000} value={context} disabled={busy} onChange={e => setContext(e.target.value)} /></label>
    <div className="aip__keys">
      <button className="btn btn--ink" disabled={busy || !ready || !task.trim()} onClick={() => void action(true)}>{t('features.localCoder.run')}</button>
      {busy && <button className="btn btn--ghost" onClick={() => abort.current?.abort()}>{t('features.localCoder.stop')}</button>}
    </div>
    {busy && <p role="status">{t('features.localCoder.working')}</p>}
    {result && <div><h4>{t('features.localCoder.result')}</h4><pre className="local-coder__result" data-testid="local-coder-result">{result}</pre></div>}
  </section>
}
