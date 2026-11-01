import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Link2, LoaderCircle } from 'lucide-react'
import { cloudRequest, useCloud } from '../../cloud'
import { useLang } from '../../i18n'
import type { OnPlan } from './DeckImport'
import { citationUrl, richSourceHtml, SOURCE_TEXT_MAX, sourcePlan, sourceText, type SourcePreview } from './import/source'
import type { PdfSourcePage } from '../ai/local-coder/pdf'
import './source.css'

export function SourceImport({ onCancel, onImport }: { onCancel: () => void; onImport: OnPlan }) {
  const lang = useLang(), de = lang === 'de'
  const active = useCloud(s => s.active)
  const workspace = active.kind === 'cloud' ? active : null
  const readOnly = useCloud(s => s.readOnly)
  const [mode, setMode] = useState<'url' | 'text' | 'pdf'>('url')
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''), [text, setText] = useState(''), [note, setNote] = useState('')
  const [preview, setPreview] = useState<SourcePreview>(), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [html, setHtml] = useState('')
  const [pdf, setPdf] = useState<{ name:string; bytes:Uint8Array; sha256:string; pages:PdfSourcePage[] }>()
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  useEffect(() => () => request.current?.abort(), [])
  const clear = () => { request.current?.abort(); setBusy(false); setPreview(undefined); setReviewed(false); setError(''); setText(''); setTitle(''); setHtml(''); setPdf(undefined); setSelectedPages([]) }
  useEffect(() => { clear(); setUrl(''); setNote('') }, [active.kind, active.id])
  const choosePages = (pages: PdfSourcePage[], numbers: number[]) => {
    setSelectedPages(numbers); setReviewed(false)
    setText(pages.filter(p => numbers.includes(p.number)).map(p => `[${de?'Seite':'Page'} ${p.number}]\n${p.text}`).join('\n\n'))
  }
  const readPdf = async (file?: File) => {
    if (!file) return
    clear(); const ac = new AbortController(); request.current = ac; setBusy(true)
    try {
      if (file.size > 20 * 1024 * 1024) throw Error(de?'Bitte eine PDF bis 20 MB auswählen.':'Choose a PDF up to 20 MB.')
      const data = await file.arrayBuffer(), bytes = new Uint8Array(data)
      if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw Error(de?'Die Datei ist keine PDF.':'This file is not a PDF.')
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('')
      const {pdfSourcePages} = await import('../ai/local-coder/pdf')
      const result = await pdfSourcePages(bytes.slice(), ac.signal)
      if (ac.signal.aborted) return
      setPdf({name:file.name,bytes,sha256:hash,pages:result.pages}); setTitle(file.name.replace(/\.pdf$/i,''))
      choosePages(result.pages,result.pages.filter(p=>p.text.trim()).map(p=>p.number))
      if (!result.pages.some(p=>p.text.trim())) setError(de?'Diese PDF enthält keinen auslesbaren Text. Für gescannte Seiten wird Texterkennung benötigt; hier wird nichts erfunden.':'This PDF has no extractable text. Scanned pages need OCR; no text is invented here.')
    } catch(e) {
      if (!ac.signal.aborted) setError((e as Error).message==='PDF_SOURCE_PAGES' ? (de?'Diese PDF hat mehr als 200 Seiten. Teile sie zuerst in kleinere Dateien auf.':'This PDF has more than 200 pages. Split it into smaller files first.') : (e as Error).message==='PDF_SOURCE_TEXT' ? (de?'Diese PDF enthält zu viel Text. Importiere einen kleineren Dateiausschnitt.':'This PDF has too much text. Import a smaller document.') : (de?'PDF konnte nicht gelesen werden; prüfe Passwortschutz und Datei. ':'PDF could not be read; check password protection and the file. ')+(e as Error).message)
    } finally { if(request.current===ac) {setBusy(false);request.current=null} }
  }
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
    try { const plan = sourcePlan({ title, text, note, url: preview?.url ?? url, preview, html:html||undefined, pdf:pdf?{...pdf,pages:pdf.pages.filter(p=>selectedPages.includes(p.number))}:undefined, lang }); onImport(plan, title, result => ({ canUndo: true, sourcePage:result.ids['external-source'] })) }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="io-source" data-testid="source-import">
    <div className="io-source__head"><span className="label">§ QUELLE · SOURCE</span><h2>{de ? 'Eine Quelle nach ONE holen' : 'Bring a source into ONE'}</h2><p>{de ? 'Du wählst den Inhalt. Prüfe die Vorschau und übernimm ihn als zitierbare externe Referenz. Es wird keine KI aufgerufen und nichts nach Atlas geschrieben.' : 'You choose the content. Review the preview and import a citable external reference. No AI is called and nothing is written to Atlas.'}</p></div>
    <div className="io-source__modes" role="group" aria-label={de ? 'Quelle wählen' : 'Choose source'}>{(['url', 'text', 'pdf'] as const).map(m => <button type="button" className={'btn' + (mode === m ? ' btn--ink' : '')} key={m} aria-pressed={mode === m} onClick={() => { clear(); setUrl(''); setMode(m) }}>{m === 'url' ? 'URL' : m==='pdf'?'PDF':de ? 'Text einfügen' : 'Paste text'}</button>)}</div>
    <label className="io-source__field"><span className="label">{mode === 'url' ? (de ? 'Öffentliche HTTPS-Adresse' : 'Public HTTPS address') : (de ? 'Quellen-URL (optional)' : 'Source URL (optional)')}</span><input className="input" type="url" value={url} disabled={busy} placeholder="https://…" onChange={e => { if (mode === 'url') clear(); else setReviewed(false); setUrl(e.target.value) }} onKeyDown={e => { if (mode === 'url' && e.key === 'Enter') { e.preventDefault(); void fetchSource() } }} /></label>
    {mode === 'url' && <><p className="muted">{de ? 'ONE ruft nur diese Adresse über den Teamserver ab. Keine Browser-Anmeldung oder Cookies werden weitergegeben. Bei Login, PDF oder dynamischen Seiten: Text einfügen oder gespeicherte Datei importieren.' : 'ONE fetches only this address through the team server. Browser login and cookies are not forwarded. For login, PDF or dynamic pages: paste text or import a saved file.'}</p><button className="btn" type="button" disabled={busy || !workspace || !url.trim()} onClick={() => void fetchSource()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}{busy ? (de ? 'Quelle wird gelesen…' : 'Reading source…') : de ? 'Vorschau laden' : 'Load preview'}</button>{!workspace && <p role="note">{de ? 'Der URL-Abruf benötigt einen angemeldeten Team-Workspace. Text und Dateien kannst du auch lokal importieren.' : 'Fetching URLs requires a signed-in team workspace. Text and files can also be imported locally.'}</p>}</>}
    {error && <p className="io-source__error" role="alert">{error}</p>}
    {mode==='pdf' && <><input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{void readPdf(e.target.files?.[0]);e.target.value=''}} /><button type="button" className="btn" disabled={busy} onClick={()=>fileInput.current?.click()}>{busy?(de?'PDF wird lokal gelesen…':'Reading PDF locally…'):(de?'PDF-Datei wählen':'Choose PDF file')}</button><p className="muted">{de?'Bis 20 MB und 200 Seiten. Die Vorschau wird auf diesem Gerät gelesen. Erst beim Übernehmen werden Originaldatei und ausgewählte Seiten in ONE gespeichert.':'Up to 20 MB and 200 pages. Preview is read on this device. The original file and selected pages are saved to ONE only when you import.'}</p>{pdf&&<fieldset className="io-source__pages"><legend>{de?'Originalseiten auswählen':'Select original pages'} · {pdf.pages.length}</legend>{pdf.pages.map(p=><label key={p.number}><input type="checkbox" checked={selectedPages.includes(p.number)} disabled={!p.text.trim()} onChange={e=>choosePages(pdf.pages,e.target.checked?[...selectedPages,p.number].sort((a,b)=>a-b):selectedPages.filter(n=>n!==p.number))} />{de?'Seite':'Page'} {p.number} · {p.text.trim()?p.text.slice(0,85):(de?'Kein auslesbarer Text':'No extractable text')}</label>)}</fieldset>}</>}
    {(mode === 'text' || preview || pdf) && <div className="io-source__preview">
      <label className="io-source__field"><span className="label">{de ? 'Titel' : 'Title'}</span><input className="input" value={title} maxLength={200} onChange={e => { setTitle(e.target.value); setReviewed(false) }} /></label>
      <label className="io-source__field"><span className="label">{de ? 'Originaltext / ausgewählter Auszug' : 'Source text / selected excerpt'} · {text.length.toLocaleString()} / {SOURCE_TEXT_MAX.toLocaleString()}</span>{html?<><div className="io-source__rich" role="region" aria-label={de?'Formatierte Vorschau':'Formatted preview'} onClick={e=>e.preventDefault()} dangerouslySetInnerHTML={{__html:html}} /><button className="btn" type="button" onClick={()=>{setHtml('');setReviewed(false)}}>{de?'Als reinen Text bearbeiten':'Edit as plain text'}</button></>:<textarea className="input io-source__text" value={text} readOnly={!!pdf} maxLength={SOURCE_TEXT_MAX} placeholder={mode==='text'?(de?'Text oder formatierten Inhalt hier einfügen (⌘V / Strg+V).':'Paste text or formatted content here (⌘V / Ctrl+V).'):undefined} onPaste={e=>{if(mode!=='text')return;const raw=e.clipboardData.getData('text/html');if(!raw.trim())return;e.preventDefault();try{const safe=richSourceHtml(raw),plain=sourceText({url:'https://clipboard.invalid',mime:'text/html',text:safe,fetchedAt:'',sha256:'',size:0}).text;if(plain.length>SOURCE_TEXT_MAX)throw Error(de?'Bitte einen kleineren Auszug einfügen.':'Paste a smaller excerpt.');setHtml(safe);setText(plain);setReviewed(false);setError('')}catch(err){setError((err as Error).message)}}} onChange={e => { setText(e.target.value); setReviewed(false) }} />}</label>
      {text.length>SOURCE_TEXT_MAX && <p role="alert" className="io-source__error">{de?'Zu viel Text: wähle weniger PDF-Seiten.':'Too much text: select fewer PDF pages.'}</p>}
      <label className="io-source__field"><span className="label">{de ? 'Wofür ist diese Quelle gedacht? (optional)' : 'What is this source for? (optional)'}</span><textarea className="input" rows={2} value={note} maxLength={4000} onChange={e => { setNote(e.target.value); setReviewed(false) }} placeholder={de ? 'Zum Beispiel: EARS als Referenz für unsere Requirement-Formulierungen.' : 'For example: EARS as a reference for our requirement wording.'} /></label>
      <p className="muted">{de ? 'Herkunft, Zeitpunkt und Inhalts-Hash bleiben bei der Quelle. Bekannte Token-Parameter werden aus dem gespeicherten Link entfernt. Die externe Aussage bleibt getrennt von bestätigten Projektanforderungen. Formatierter Text behält Tabellen, Listen und Links; Bilder und Skripte bleiben draußen.' : 'Origin, time and content hash stay with the source. Common token parameters are removed from the saved link. External statements remain distinct from confirmed project requirements. Formatted text keeps tables, lists and links; images and scripts are excluded.'}</p>
      <label className="io-source__review"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />{de ? 'Vorschau geprüft - diesen Inhalt als externe Referenz übernehmen.' : 'Preview reviewed - import this content as an external reference.'}</label>
    </div>}
    <div className="io-actions"><button className="btn" type="button" onClick={onCancel}><ArrowLeft size={15} />{de ? 'Zurück' : 'Back'}</button><button className="btn btn--ink" type="button" disabled={!reviewed || !text.trim() || text.length>SOURCE_TEXT_MAX || !title.trim() || busy || readOnly} onClick={save}><Check size={15} />{de ? 'Quelle übernehmen' : 'Import source'}</button></div>
  </div>
}
