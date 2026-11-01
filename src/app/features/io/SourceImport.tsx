import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Link2, LoaderCircle } from 'lucide-react'
import { cloudRequest, useCloud } from '../../cloud'
import { useLang } from '../../i18n'
import type { OnPlan } from './DeckImport'
import { citationUrl, SOURCE_TEXT_MAX, sourcePlan, sourceText, type SourcePreview } from './import/source'
import './source.css'

export function SourceImport({ onCancel, onImport }: { onCancel: () => void; onImport: OnPlan }) {
  const lang = useLang(), de = lang === 'de'
  const active = useCloud(s => s.active)
  const workspace = active.kind === 'cloud' ? active : null
  const readOnly = useCloud(s => s.readOnly)
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''), [text, setText] = useState(''), [note, setNote] = useState('')
  const [preview, setPreview] = useState<SourcePreview>(), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const clear = () => { request.current?.abort(); setBusy(false); setPreview(undefined); setReviewed(false); setError(''); setText(''); setTitle('') }
  useEffect(() => { clear(); setUrl(''); setNote('') }, [active.kind, active.id])
  const fetchSource = async () => {
    if (!workspace || readOnly || busy) return
    const ac = new AbortController(); request.current = ac; setBusy(true); setError(''); setReviewed(false)
    try {
      citationUrl(url.trim())
      const result = await cloudRequest<SourcePreview>('POST', `api/workspaces/${encodeURIComponent(workspace.id)}/sources/preview`, { url: url.trim() }, { signal: ac.signal })
      if (ac.signal.aborted) return
      const extracted = sourceText(result)
      if (!extracted.text) throw Error(de ? 'Kein lesbarer statischer Text. Kopiere den sichtbaren Inhalt in „Text einfügen“.' : 'No readable static text. Copy the visible content into “Paste text”.')
      if (extracted.text.length > SOURCE_TEXT_MAX) throw Error(de ? 'Zu viel Text. Wähle einen Auszug und füge ihn unter „Text einfügen“ ein.' : 'Too much text. Select an excerpt and use “Paste text”.')
      setPreview(result); setTitle(extracted.title); setText(extracted.text)
    } catch (e) {
      const messages: Record<string, string> = {
        url_blocked: 'Nutze eine öffentliche HTTPS-Adresse ohne Zugangsdaten. Interne Adressen sind über diesen Server nicht erreichbar; füge den Text ein.',
        source_type: 'Dieser Abruf unterstützt HTML, Text, Markdown und JSON. Speichere andere Dokumente als Datei oder füge den Text ein.',
        source_too_large: 'Die Quelle ist größer als 2 MB. Wähle einen Auszug und nutze „Text einfügen“.',
        source_encoding: 'Die Textkodierung oder Komprimierung kann nicht gelesen werden. Nutze „Text einfügen“ oder eine gespeicherte HTML-Datei.',
        source_empty: 'Die Quelle enthält keinen lesbaren Inhalt. Füge den sichtbaren Text ein.',
        source_fetch_failed: 'Die Quelle ist nicht erreichbar, benötigt eine Anmeldung oder blockiert den Abruf. Nutze „Text einfügen“ oder importiere eine gespeicherte Datei.',
      }
      if (!ac.signal.aborted) setError((de && messages[(e as { code?: string }).code ?? '']) || (e as Error).message)
    }
    finally { if (request.current === ac) { setBusy(false); request.current = null } }
  }
  const save = () => {
    if (!reviewed || busy || readOnly) return
    try { const plan = sourcePlan({ title, text, note, url: preview?.url ?? url, preview, lang }); onImport(plan, title, () => ({ canUndo: true })) }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="io-source" data-testid="source-import">
    <div className="io-source__head"><span className="label">§ QUELLE · SOURCE</span><h2>{de ? 'Eine Quelle nach ONE holen' : 'Bring a source into ONE'}</h2><p>{de ? 'Du wählst den Inhalt. Prüfe die Vorschau und übernimm ihn als zitierbare externe Referenz. Es wird keine KI aufgerufen und nichts nach Atlas geschrieben.' : 'You choose the content. Review the preview and import a citable external reference. No AI is called and nothing is written to Atlas.'}</p></div>
    <div className="io-source__modes" role="group" aria-label={de ? 'Quelle wählen' : 'Choose source'}>{(['url', 'text'] as const).map(m => <button type="button" className={'btn' + (mode === m ? ' btn--ink' : '')} key={m} aria-pressed={mode === m} onClick={() => { clear(); setMode(m) }}>{m === 'url' ? 'URL' : de ? 'Text einfügen' : 'Paste text'}</button>)}</div>
    <label className="io-source__field"><span className="label">{mode === 'url' ? (de ? 'Öffentliche HTTPS-Adresse' : 'Public HTTPS address') : (de ? 'Quellen-URL (optional)' : 'Source URL (optional)')}</span><input className="input" type="url" value={url} disabled={busy} placeholder="https://…" onChange={e => { if (mode === 'url') clear(); else setReviewed(false); setUrl(e.target.value) }} onKeyDown={e => { if (mode === 'url' && e.key === 'Enter') { e.preventDefault(); void fetchSource() } }} /></label>
    {mode === 'url' && <><p className="muted">{de ? 'ONE ruft nur diese Adresse über den Teamserver ab. Keine Browser-Anmeldung oder Cookies werden weitergegeben. Bei Login, PDF oder dynamischen Seiten: Text einfügen oder gespeicherte Datei importieren.' : 'ONE fetches only this address through the team server. Browser login and cookies are not forwarded. For login, PDF or dynamic pages: paste text or import a saved file.'}</p><button className="btn" type="button" disabled={busy || !workspace || !url.trim()} onClick={() => void fetchSource()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}{busy ? (de ? 'Quelle wird gelesen…' : 'Reading source…') : de ? 'Vorschau laden' : 'Load preview'}</button>{!workspace && <p role="note">{de ? 'Der URL-Abruf benötigt einen angemeldeten Team-Workspace. Text und Dateien kannst du auch lokal importieren.' : 'Fetching URLs requires a signed-in team workspace. Text and files can also be imported locally.'}</p>}</>}
    {error && <p className="io-source__error" role="alert">{error}</p>}
    {(mode === 'text' || preview) && <div className="io-source__preview">
      <label className="io-source__field"><span className="label">{de ? 'Titel' : 'Title'}</span><input className="input" value={title} maxLength={200} onChange={e => { setTitle(e.target.value); setReviewed(false) }} /></label>
      <label className="io-source__field"><span className="label">{de ? 'Originaltext / ausgewählter Auszug' : 'Source text / selected excerpt'} · {text.length.toLocaleString()} / {SOURCE_TEXT_MAX.toLocaleString()}</span><textarea className="input io-source__text" value={text} maxLength={SOURCE_TEXT_MAX} onChange={e => { setText(e.target.value); setReviewed(false) }} /></label>
      <label className="io-source__field"><span className="label">{de ? 'Wofür ist diese Quelle gedacht? (optional)' : 'What is this source for? (optional)'}</span><textarea className="input" rows={2} value={note} maxLength={4000} onChange={e => { setNote(e.target.value); setReviewed(false) }} placeholder={de ? 'Zum Beispiel: EARS als Referenz für unsere Requirement-Formulierungen.' : 'For example: EARS as a reference for our requirement wording.'} /></label>
      <p className="muted">{de ? 'Herkunft, Zeitpunkt und Inhalts-Hash bleiben bei der Quelle. Bekannte Token-Parameter werden aus dem gespeicherten Link entfernt. Die externe Aussage bleibt getrennt von bestätigten Projektanforderungen. Tabellen werden als Text übernommen; Bilder und Skripte bleiben draußen.' : 'Origin, time and content hash stay with the source. Common token parameters are removed from the saved link. External statements remain distinct from confirmed project requirements. Tables become text; images and scripts are excluded.'}</p>
      <label className="io-source__review"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />{de ? 'Vorschau geprüft - diesen Inhalt als externe Referenz übernehmen.' : 'Preview reviewed - import this content as an external reference.'}</label>
    </div>}
    <div className="io-actions"><button className="btn" type="button" onClick={onCancel}><ArrowLeft size={15} />{de ? 'Zurück' : 'Back'}</button><button className="btn btn--ink" type="button" disabled={!reviewed || !text.trim() || !title.trim() || busy || readOnly} onClick={save}><Check size={15} />{de ? 'Quelle übernehmen' : 'Import source'}</button></div>
  </div>
}
