import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { readAttachments, type CoderAttachment } from './attachments'

export function AttachmentPicker({ files, onChange, onBusy, disabled }: { files: CoderAttachment[]; onChange: (files: CoderAttachment[]) => void; onBusy: (busy: boolean) => void; disabled: boolean }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { abort.current?.abort(); onBusy(false) }, [onBusy])
  const add = async (picked: FileList | null) => {
    if (!picked?.length) return
    const controller = new AbortController(); abort.current = controller
    setLoading(true); onBusy(true); setError('')
    try {
      const imported = await readAttachments(Array.from(picked), AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]), Math.max(0, 500000 - files.reduce((n, f) => n + f.text.length, 0)))
      controller.signal.throwIfAborted()
      const names = new Set(imported.map(f => f.name))
      const kept = files.filter(f => !names.has(f.name))
      if (kept.length + imported.length > 100) throw new Error('count')
      onChange([...kept, ...imported])
    } catch (e) { if (!controller.signal.aborted) setError(t(e instanceof Error && e.message === 'count' ? 'features.localCoder.files.count' : 'features.localCoder.files.failed')) }
    finally { if (abort.current === controller) { setLoading(false); onBusy(false); abort.current = null } }
  }
  return <fieldset className="local-coder__attachments" disabled={disabled || loading}>
    <legend>{t('features.localCoder.files.title')}</legend>
    <p className="st-p">{t('features.localCoder.files.hint')}</p>
    <div className="aip__keys">
      <button type="button" className="btn btn--sm" onClick={() => input.current?.click()}>{t('features.localCoder.files.add')}</button>
      <button type="button" className="btn btn--sm" onClick={() => folder.current?.click()}>{t('features.localCoder.files.folder')}</button>
      {!!files.length && <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange([])}>{t('features.localCoder.files.clear')}</button>}
    </div>
    <input ref={input} type="file" multiple hidden data-testid="local-coder-files" onChange={e => { void add(e.target.files); e.target.value = '' }} />
    <input ref={folder} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} data-testid="local-coder-folder" onChange={e => { void add(e.target.files); e.target.value = '' }} />
    {loading && <p role="status">{t('features.localCoder.files.loading')}</p>}
    {error && <p role="alert">{error}</p>}
    <ul className="local-coder__files">
      {files.map(file => <li key={file.id}>
        <div className="local-coder__file">
          <label><input type="checkbox" checked={file.selected} disabled={!file.text} onChange={e => onChange(files.map(f => f.id === file.id ? { ...f, selected: e.target.checked } : f))} /><span>{file.name}</span></label>
          <button type="button" className="btn btn--sm btn--ghost" aria-label={`${t('features.localCoder.files.remove')}: ${file.name}`} onClick={() => onChange(files.filter(f => f.id !== file.id))}>×</button>
        </div>
        {file.issue && <p className="st-p">{t(`features.localCoder.files.${file.issue}`)}</p>}
        {!!file.text && <details><summary>{t('features.localCoder.files.preview')} · {file.text.length.toLocaleString()}</summary><pre className="local-coder__result">{file.text.slice(0, 16000)}{file.text.length > 16000 ? '\n…' : ''}</pre></details>}
      </li>)}
    </ul>
  </fieldset>
}
