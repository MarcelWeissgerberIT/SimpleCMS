import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { useLang } from '../../i18n'
import { useCloud } from '../../cloud'
import { useCoding } from '../coding/state'
import { requestRepoFiles } from '../coding/service'
import { repoFileMarkdown, type RepoFilesResult } from '@/shared/repo-files'
import './repo-files.css'

/** Shared picker: task fields, page prompts and the terminal all insert the same path references. */
export function RepoFilesControl({value,onChange,repo:fixed,branch:initialBranch,disabled=false}:{value:string;onChange:(v:string)=>void;repo?:string|null;branch?:string|null;disabled?:boolean}) {
 const lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 const worker=useCoding(s=>s.worker), conn=useCoding(s=>s.conn), can=useCoding(s=>s.can)
 const active=useCloud(s=>s.active), user=useCloud(s=>s.user?.id)
 const scope=JSON.stringify([active,user,worker?.name,conn])
 const [open,setOpen]=useState(false),[repo,setRepo]=useState(fixed??''),[branch,setBranch]=useState(initialBranch??''),[query,setQuery]=useState('')
 const [listing,setListing]=useState<RepoFilesResult|null>(null),[preview,setPreview]=useState<RepoFilesResult|null>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const generation=useRef(0), lastTrigger=useRef(''), origin=useRef(scope)
 const token=/(?:^|\s)(\/files|@[^\s]*[/.][^\s]*)$/.exec(value)
 useEffect(()=>{if(token && lastTrigger.current!==token[0]&&!disabled){lastTrigger.current=token[0];setQuery(token[1]!.startsWith('@')?token[1]!.slice(1):'');setOpen(true)}if(!token)lastTrigger.current=''},[value,disabled]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{generation.current++;setOpen(false);setPreview(null);setListing(null);setSelected([]);origin.current=scope},[scope])
 useEffect(()=>{setRepo(fixed||worker?.repos[0]?.name||'');setBranch(initialBranch??'');setSelected([]);setPreview(null)},[fixed,initialBranch,worker?.repos.map(r=>r.name).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{setSelected([])},[repo,branch])
 useEffect(()=>{
   const n=++generation.current;setListing(null);setPreview(null);setError('')
   if(!open||!repo)return
   const timer=setTimeout(()=>{setBusy(true);void requestRepoFiles({repo,action:'list',query,branch:branch||undefined}).then(r=>{if(n===generation.current)setListing(r)}).catch(e=>{if(n===generation.current)setError(String(e.message??e))}).finally(()=>{if(n===generation.current)setBusy(false)})},180)
   return()=>{clearTimeout(timer);generation.current++}
 },[open,repo,branch,query])
 const read=async(path:string)=>{const n=++generation.current;setBusy(true);setError('');try{const r=await requestRepoFiles({repo,action:'read',path,branch:branch||undefined});if(n===generation.current)setPreview(r)}catch(e){if(n===generation.current)setError(String((e as Error).message))}finally{if(n===generation.current)setBusy(false)}}
 const insert=()=>{if(origin.current!==scope||!selected.length)return;const links=selected.map(path=>repoFileMarkdown({repo,path,...(listing?.branch && listing.branch!=='(detached HEAD)'?{branch:listing.branch}:{})})).join('\n');const next=token?value.slice(0,value.length-token[0].length):value;onChange(next+(next?'\n':'')+links+'\n');setOpen(false)}
 return <><button type="button" className="btn btn--sm repo-files-trigger" disabled={disabled} onClick={()=>{setOpen(true);setQuery('')}}>＋ {tr('Repo-Dateien','Repo files')} <small>/files</small></button>
 <Modal open={open} onClose={()=>{generation.current++;setOpen(false)}} title={tr('Repository-Dateien auswählen','Select repository files')} label="@ · /files" width={960}>
 <div className="repo-files" data-testid="repo-files-picker">
 <p>{tr('Aus deinem persönlichen Worker. Nur ausgewählte Textauszüge werden beim Start an das gewählte Modell übergeben. Aufgaben speichern nur Pfadverweise; jeder Lauf liest den aktuellen Arbeitsstand erneut.','From your own worker. Only selected text excerpts go to the chosen model at start. Tasks store path references; every run reads its current worktree again.')}</p>
 {!can?.includes('repo-files')&&<p role="alert">{tr('Eigenen Worker verbinden und aktualisieren, dann erneut öffnen.','Connect and update your own worker, then reopen.')}</p>}
 <div className="repo-files__filters"><label>Repository<select className="input" value={repo} disabled={!!fixed} onChange={e=>setRepo(e.target.value)}><option value="">—</option>{worker?.repos.map(r=><option key={r.name}>{r.name}</option>)}</select></label>
 <label>{tr('Arbeitsstand','Worktree')}<select className="input" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">{tr('Aktueller Checkout','Current checkout')}</option>{worker?.repos.find(r=>r.name===repo)?.branches?.map(b=><option key={b}>{b}</option>)}</select></label>
 <label>{tr('Dateipfad suchen','Search path')}<input className="input" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} placeholder="src/ · README · .cpp"/></label></div>
 <p className="label" aria-live="polite">{busy?tr('Lese lokalen Arbeitsstand…','Reading local worktree…'):listing?`${listing.repo} · ${listing.branch} · ${listing.paths?.length??0} ${tr('Dateien','files')}`:''}</p>
 {error&&<p role="alert">{error}</p>}
 <div className="repo-files__body"><div className="repo-files__list" aria-label={tr('Dateien','Files')}>{listing?.paths?.map(path=><div key={path} className="repo-files__row"><input type="checkbox" aria-label={path} checked={selected.includes(path)} disabled={!selected.includes(path)&&selected.length>=8} onChange={e=>setSelected(s=>e.target.checked?[...s,path]:s.filter(p=>p!==path))}/><button type="button" onClick={()=>void read(path)}>{path}</button></div>)}{listing?.paths?.length===0&&<p>{tr('Keine passenden Dateien. Suche ändern.','No matching files. Change the search.')}</p>}</div>
 <div className="repo-files__preview">{preview?.file?<><strong>{preview.file.path}</strong><p className="label">{preview.branch} · SHA256 {preview.file.revision.slice(0,12)} · {preview.file.start_line}–{preview.file.end_line}/{preview.file.total_lines}</p><pre>{preview.file.content}</pre>{!preview.file.complete&&<p>{tr('Gekürzter Auszug.','Clipped excerpt.')}</p>}</>:<p>{tr('Dateinamen anklicken für die Vorschau. Bis zu acht Dateien auswählen.','Click a filename to preview. Select up to eight files.')}</p>}</div></div>
 <p>{tr('Versteckte Dateien, Schlüssel, generierte Ordner und symbolische Links bleiben ausgeschlossen.','Hidden files, keys, generated folders and symbolic links remain excluded.')}{listing?.truncated&&' '+tr('Ergebnis begrenzt — gezielter suchen.','Results limited — narrow the search.')}</p>
 <button type="button" className="btn btn--primary" disabled={!selected.length||busy} onClick={insert}>{tr('Dateiverweise übernehmen','Add file references')} ({selected.length}/8)</button>
 </div></Modal></>
}
