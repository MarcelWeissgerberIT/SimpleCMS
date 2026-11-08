import {useSessionDraft} from '../../features/ai/workflow/sessionDraft'
import {freshMockDraft,validMockDraft} from '../../features/ai/workflow/mockDraft'
import {useBlockLocation} from '../../lib/blockLocation'
import {ResultProgress} from '../../features/ai/workflow/ResultProgress'
import type {MockRegion} from '@/shared/ai/mockRegion'
import {flushEditor,editAs} from '../lib/editAs'
import {safeMockPreview} from './MockComparison'
import {MockPreviewFrame} from './MockPreviewFrame'
import {MockComponentTree} from './MockComponentTree'
import {mockVersionKey,checkpointMock,mockReviewTask,mockNoteElements,MOCK_SELECTION_LIMIT,type MockElement,type MockFeedback} from '@/shared/ai/mockReview'
import DOMPurify from 'dompurify'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useEditorState, NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { sameMockBlock, mockBlockData, mockBlockFrame, mockBlocksAllowed, type MockBlockData, type MockBlockPreview } from '@/shared/ai/mockBlock'
import {mockColorToken,mockColorStyle,mockProvenance} from '@/shared/ai/mockBlockProvenance'
import {sha256Hex} from '@/shared/mcp/sha256'
import type {DesignMock} from '@/shared/ai/designMock'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import './designMock.css'
const tabs=['mock','colors','atlas','feedback','versions','components'] as const
const Composer=lazy(()=>import('../../features').then(m=>({default:m.MockBlockComposer})))
const Revisions=lazy(()=>import('../../features').then(m=>({default:m.PendingMockRevisions})))
const ReviewPanel=lazy(()=>import('../../features').then(m=>({default:m.MockReviewPanel})))
const AtlasCard=lazy(()=>import('../../features').then(m=>({default:m.DesignMockCard})))

const safePreview=safeMockPreview
const SourcePanel=lazy(()=>import('../../features').then(m=>({default:m.MockSourcePanel})))
const pickerHex=(value:string)=>{const ctx=document.createElement('canvas').getContext('2d')!;ctx.fillStyle=value;return /^#[a-f0-9]{6}$/i.test(ctx.fillStyle)?ctx.fillStyle:'#000000'}
export function DesignMockView({node,editor,getPos}:ReactNodeViewProps) {
 const t=useT(),spec=useMemo(()=>mockBlockData(node.attrs.spec),[node.attrs.spec]),[large,setLarge]=useState(false)
 const de=useWorkspace(s=>s.settings.language==='de'),tabId=useId(),[tab,setTab]=useState<typeof tabs[number]>('mock')
 const pageId=editor.view.dom.getAttribute('data-page-id'),epoch=useWorkspace(s=>s.epoch)
 const [draft,setDraft,draftSaved]=useSessionDraft('mock:'+pageId+':'+node.attrs.id,freshMockDraft,validMockDraft)
 const {selection,region:selectionRegion,version:selectionVersion}=draft
 const setSelection=(next:MockElement[]|((items:MockElement[])=>MockElement[]))=>setDraft(d=>({...d,selection:typeof next==='function'?next(d.selection):next}))
 const setSelectionRegion=(region:MockRegion|undefined)=>setDraft(d=>({...d,region}))
 const setSelectionVersion=(version:string)=>setDraft(d=>({...d,version}))
 const [markMode,setMarkMode]=useState<'element'|'area'>('element'),[marking,setMarking]=useState(false),[inspected,setInspected]=useState<MockFeedback|null>(null)
 const locked=useWorkspace(s=>!!pageId&&!!s.pages[pageId]?.settings.locked),viewer=useCloud(s=>s.readOnly)
 const editorEditable=useEditorState({editor,selector:({editor:e})=>!e.isDestroyed&&e.isEditable})
 const supported=useCloud(mockBlocksAllowed)
 const editable=editorEditable&&!locked&&!viewer&&supported
 const linkedNote=useRef('')
 useEffect(()=>{const locate=()=>{const query=new URLSearchParams(window.location.hash.split('?')[1]??''),id=query.get('mockNote'),journal=query.get('mockJournal'),key=journal+':'+id
  if(journal!==spec.journal?.id||linkedNote.current===key)return
  const note=spec.journal.notes.find(n=>n.id===id);if(note){linkedNote.current=key;setTab('feedback');setInspected(note)}
 };locate();window.addEventListener('hashchange',locate);return()=>window.removeEventListener('hashchange',locate)},[spec.journal])
 const location=useBlockLocation(pageId,node.attrs.id),handledLocation=useRef(''),[locationError,setLocationError]=useState(''),[locatedKey,setLocatedKey]=useState('')
 useEffect(()=>{
  if(!location||handledLocation.current===location.key)return
  handledLocation.current=location.key
  const view=location.view
  const validView=view==='proposal'||tabs.includes(view as typeof tabs[number])
  const validItem=!location.item||view==='feedback'&&spec.journal?.notes.some(n=>n.id===location.item)||view==='proposal'&&spec.journal?.proposals?.some(p=>p.id===location.item&&p.status==='pending')
  if(!validView||!validItem){setLocationError(t('workflow.locationMissing'));return}
  setLocationError('');setLocatedKey(location.key);setMarking(false);setTab(view==='proposal'?'mock':view as typeof tabs[number])
 },[location])
 const latest=useRef(spec);latest.current=spec
 const change=(next:MockBlockData,expected=spec,sourceCheck=false):boolean=>{
  const refused=()=>{setActionError(de?'Nicht gespeichert: Der Mock oder deine Schreibrechte haben sich geändert. Eine offene Notiz bleibt im Eingabefeld. Prüfe den aktuellen Stand und versuche es erneut.':'Not saved: the mock or your write access has changed. Any pending note stays in its input field. Review the current state and try again.');return false}
  if(editor.isDestroyed||!editor.isEditable||useCloud.getState().readOnly||!mockBlocksAllowed(useCloud.getState())||epoch!==useWorkspace.getState().epoch||!!pageId&&useWorkspace.getState().pages[pageId]?.settings.locked)return refused()
  const pos=getPos();if(typeof pos!=='number'||editor.state.doc.nodeAt(pos)?.type.name!=='designMock')return refused()
  if(!sameMockBlock(editor.state.doc.nodeAt(pos)!.attrs.spec,expected))return refused()
  const write=()=>editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...editor.state.doc.nodeAt(pos)!.attrs,spec:next}))
  if(sourceCheck)editAs(editor,{kind:'system',why:'bookkeeping'},write)
  else{write();flushEditor(editor)}
  if(!sameMockBlock(editor.state.doc.nodeAt(pos)?.attrs.spec,next))return refused()
  setActionError('');return true
 }
 const [device,setDevice]=useState('original'),[scenario,setScenario]=useState('empty'),[actionError,setActionError]=useState('')
 const actionErrorRef=useRef<HTMLParagraphElement|null>(null)
 useEffect(()=>{if(actionError)actionErrorRef.current?.scrollIntoView({block:'nearest'})},[actionError])
 const preview=spec.preview
 const displayWidth=device==='mobile'?390:device==='tablet'?768:device==='desktop'?1440:preview?.width??960
 const requestChange=(element:MockElement,text:string,variant?:string)=>{if(!preview||!editable||!pageId)return;try{const next=checkpointMock(spec,'Vor Änderung'),note:MockFeedback={id:crypto.randomUUID(),at:new Date().toISOString(),version:mockVersionKey(preview),element,text,intent:'replace',scope:'mock',resolved:false,md:'none',scenario:variant};if(next.journal!.notes.length>=150)throw Error('Notizlimit erreicht.');next.journal={...next.journal!,notes:[...next.journal!.notes,note]};if(!change(next))return;setTab('feedback');const isolated={...next,journal:{...next.journal,notes:[note]}};const task=mockReviewTask(isolated,pageId);if(task)void import('../../features').then(m=>m.openAgent({task,run:false}));setActionError('')}catch(e){setActionError(String(e))}}
 const safeDocument=useMemo(()=>preview?safePreview(preview):'',[preview])
 const [viewedVersionKey,setViewedVersionKey]=useState<string|null>(null)
 const viewedVersion=spec.journal?.versions.find(v=>v.key===viewedVersionKey)
 const viewedVersionNumber=(spec.journal?.versions.findIndex(v=>v.key===viewedVersionKey)??-1)+1
 const inspectedVersion=spec.journal?.versions.find(v=>v.key===inspected?.version)
 const effectiveHash=sha256Hex(safeDocument)
 const receipt=preview?.provenance
 const isSaved=!!receipt?.atlasSaved&&(preview?.savedHtmlHash===effectiveHash||!Object.keys(preview?.colors??{}).length&&preview?.savedHtmlHash===preview?.htmlHash)
 const artifact:DesignMock|null=preview&&receipt?{...receipt,title:preview.title,width:preview.width,height:preview.height,createdAt:preview.createdAt,document:safeDocument,htmlHash:effectiveHash,review:'open',colorAdjustments:preview.colors,atlasSaved:receipt.atlasSaved}:null
 const persist=(a:DesignMock,saved:boolean)=>{const current=latest.current,p=current.preview;if(p&&p.provenance?.id===a.id)change({...current,preview:{...p,provenance:mockProvenance({...a,document:undefined}),targetUrl:a.atlasSaved?.url??a.atlasDestination?.url??p.targetUrl,savedHtmlHash:saved?a.htmlHash:p.savedHtmlHash}},current)}
 const color=(name:string,value?:string)=>{if(!preview)return;const colors={...preview.colors};if(value)colors[name]=value;else delete colors[name];change({...spec,preview:{...preview,colors}})}
 const colorTokens=receipt?.draft.tokens.filter(t=>mockColorToken(t.value))??[]
 const activeSelection=preview&&selectionVersion===mockVersionKey(preview)?selection:[]
 const activeRegion=activeSelection.length?selectionRegion:undefined
 const selectArea=(region:MockRegion,element:MockElement)=>{if(!preview||!editable)return;setSelectionRegion(region);setSelection([element]);setSelectionVersion(mockVersionKey(preview))}
 const selectElement=(element:MockElement)=>{
  if(!preview||!editable)return
  const version=mockVersionKey(preview)
  setSelectionRegion(undefined)
  setSelection(items=>{const current=selectionVersion===version&&!selectionRegion?items:[];return current.some(e=>e.path===element.path)?current.filter(e=>e.path!==element.path):current.length<MOCK_SELECTION_LIMIT?[...current,element]:current})
  setSelectionVersion(version)
 }
 const chooseTab=(next:typeof tabs[number])=>{if(next!=='mock'&&next!=='feedback')setMarking(false);setTab(next)}
 const writeNote=()=>{setLarge(false);setTab('feedback')}
 const selectionTools=<div className="mock-block__selection-tools">
  {editable&&<button type="button" className="btn btn--sm" aria-pressed={marking&&markMode==='element'} onClick={()=>{setMarkMode('element');setMarking(markMode!=='element'||!marking)}}>{marking&&markMode==='element'?(de?'Markieren beenden':'Stop marking'):(de?'Element markieren':'Mark element')}</button>}
  {editable&&<button type="button" className="btn btn--sm" aria-pressed={marking&&markMode==='area'} onClick={()=>{setMarkMode('area');setMarking(markMode!=='area'||!marking)}}>{marking&&markMode==='area'?(de?'Bereichsmarkierung beenden':'Stop area marking'):(de?'Bereich markieren':'Mark area')}</button>}
  {!!activeSelection.length&&<><span role="status">{activeRegion?(de?'Bereich: ':'Area: ')+Math.round(activeRegion.width)+' × '+Math.round(activeRegion.height)+' px':(de?'Markierte Elemente: ':'Selected elements: ')+activeSelection.length+' / '+MOCK_SELECTION_LIMIT}</span><button type="button" className="btn btn--primary btn--sm" onClick={writeNote}>{de?'Notiz zur Auswahl schreiben':'Write note for selection'}</button></>}
  {marking&&<span className="faint">{markMode==='area'?(de?'Ein Rechteck im Mock aufziehen – auch über freie Flächen. Erneut ziehen ersetzt den Bereich.':'Drag a rectangle in the mock, including empty space. Drag again to replace the area.'):activeSelection.length>=MOCK_SELECTION_LIMIT?(de?'Auswahl voll. Ein erneuter Klick entfernt ein Element.':'Selection full. Click an element again to remove it.'):(de?'Mehrere Elemente nacheinander anklicken; erneut klicken zum Abwählen.':'Click several elements in turn; click again to deselect.')}</span>}
 </div>
 const previewFrame=(enabled:boolean)=><MockPreviewFrame document={safeDocument} title={preview!.title} width={displayWidth} height={preview!.height} marking={enabled&&marking&&editable} areaMarking={markMode==='area'} onRegion={selectArea} region={activeRegion?.viewportWidth===displayWidth?activeRegion:undefined} highlights={activeRegion?[]:activeSelection.map(e=>e.path)} onSelect={selectElement}/>

 const configuration=<details contentEditable={false} open={!preview}><summary>{t('editor.mock.configure')}</summary>{editable?<Suspense fallback={null}><Composer value={spec} onChange={change}/></Suspense>:<div><p>{spec.request}</p><p>{spec.source}</p><p>{spec.requirement}</p></div>}</details>
 return <NodeViewWrapper data-work-location={locatedKey||undefined} className="mock-block" data-type="design-mock">
  <header contentEditable={false}><strong>{t('editor.block.designMock')}</strong><span className="label">{t('editor.mock.static')}</span></header>
  <NodeViewContent className="mock-block__title"/>
  {actionError&&<p ref={actionErrorRef} contentEditable={false} role="alert">{actionError}</p>}
  {locationError&&<p contentEditable={false} role="alert">{locationError}</p>}


  {!preview&&configuration}
  {preview&&<section className="mock-block__settings" contentEditable={false}>
   <Suspense fallback={null}><Revisions journal={spec.journal?.id} stored={spec.journal?.proposals} focusId={location?.view==='proposal'?location.item:undefined} focusRequest={location?.key}/></Suspense>
   {(draft.text||draft.selection.length>0)&&tab!=='feedback'&&<button className="btn btn--sm" onClick={()=>setTab('feedback')}>{t('workflow.resumeMockDraft')}</button>}
   <div className="mock-block__tabs" role="tablist" aria-label={de?'Mock-Einstellungen':'Mock settings'} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];chooseTab(next);document.getElementById(tabId+'-'+next)?.focus()}}}>
    {tabs.map((key,index)=><button key={key} id={tabId+'-'+key} role="tab" aria-selected={tab===key} aria-controls={tabId+'-panel-'+key} tabIndex={tab===key?0:-1} onClick={()=>chooseTab(key)}><span className="mock-block__tab-index" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{key==='mock'?'Mock':key==='colors'?(de?'Farben':'Colours'):key==='atlas'?'Atlas':key==='feedback'?(de?'Notizen':'Notes'):key==='versions'?(de?'Versionen':'Versions'):(de?'Komponenten':'Components')}</button>)}
   </div>
   <ResultProgress phase={spec.journal?.proposals?.some(p=>p.status==='pending')?'review':'adopted'} saved={de?'Die angezeigte Vorschau ist auf dieser One-Seite gespeichert. Atlas hat einen getrennten Speicherstand.':'The displayed preview is saved on this One page. Atlas has a separate saved state.'} next={spec.journal?.proposals?.some(p=>p.status==='pending')?(de?'Neuen Vorschlag vergleichen und ausdrücklich übernehmen.':'Compare the new proposal and explicitly adopt it.'):(de?'Mock prüfen, Stellen markieren oder Rückmeldungen bewerten.':'Review the mock, mark locations or assess feedback.')}/>
   <Suspense fallback={null}><SourcePanel value={spec} onChange={(next,checked)=>change(next,spec,checked)} editable={editable} de={de} compact={tab!=='atlas'} onOpen={()=>chooseTab('atlas')}/></Suspense>
   <div role="tabpanel" id={tabId+'-panel-'+tab} aria-labelledby={tabId+'-'+tab} className="mock-block__panel">
    <div hidden={tab!=='feedback'&&tab!=='versions'}><Suspense fallback={null}><ReviewPanel draft={draft} setDraft={setDraft} draftSaved={draftSaved} focusItem={location?.view==='feedback'?location.item:undefined} focusRequest={location?.key} value={spec} onChange={change} selection={preview&&selectionVersion===mockVersionKey(preview)?selection:[]} region={activeRegion} onRemoveSelection={path=>{setSelectionRegion(undefined);setSelection(items=>items.filter(e=>e.path!==path))}} onClear={()=>{setSelection([]);setSelectionRegion(undefined);setMarking(false)}} pageId={pageId} editable={editable} mode={tab==='versions'?'versions':'feedback'} onLocate={setInspected} onPreviewVersion={setViewedVersionKey}/></Suspense></div>
    {tab==='components'?<MockComponentTree key={effectiveHash} html={safeDocument} title={preview.title} width={preview.width} height={preview.height} de={de} provenance={receipt} onReplace={editable?element=>requestChange(element,'Suche eine passende alternative Katalog-Komponente für '+element.component+' an dieser Stelle. Begründe die Wahl; erhalte die Funktion und alle anderen Bereiche.'):undefined}/>:tab==='mock'?configuration:tab==='feedback'||tab==='versions'?null:tab==='colors'?<>
     <p className="faint">{de?'Farben für diesen Entwurf anpassen. Änderungen werden auf der One-Seite gespeichert; Atlas wird erst auf deinen Klick aktualisiert.':'Adjust this proposal’s colours. Changes are saved on the One page; Atlas is updated only when you choose to upload.'}</p>
     {colorTokens.length?<div className="mock-block__colors">{colorTokens.map(token=>{const value=preview.colors?.[token.name]??token.value;return <div className="mock-block__color" key={token.name}><label><input type="color" aria-label={token.name+(de?' Farbe':' colour')} value={pickerHex(value)} disabled={!editable} onChange={e=>color(token.name,e.target.value)}/><span><strong>{token.name.replace(/^--/,'').replace(/-/g,' ')}</strong><small>{de?'Original: ':'Original: '}{token.value}</small></span></label><input aria-label={token.name+' Hex'} key={value} defaultValue={value} disabled={!editable} maxLength={9} onBlur={e=>{if(/^#[a-f0-9]{6}$/i.test(e.target.value))color(token.name,e.target.value);else e.target.value=value}}/><button className="btn btn--sm" disabled={!editable||!preview.colors?.[token.name]} onClick={()=>color(token.name)}>{de?'Zurücksetzen':'Reset'}</button></div>})}</div>:<p>{de?'Für diese Vorschau sind keine bearbeitbaren Farbwerte hinterlegt. Ein neu übernommenes KI-Ergebnis bringt seine Designwerte mit.':'This preview has no editable colour values. Newly adopted AI results include their design tokens.'}</p>}
    </>:<>
     <div className="mock-block__atlas-status"><strong>{receipt?.atlasSaved?(isSaved?(de?'In Atlas gespeichert':'Saved in Atlas'):(de?'Änderungen noch nicht in Atlas':'Changes not yet in Atlas')):receipt?.atlasDestination?(de?'Atlas-Übertragung unvollständig':'Atlas upload incomplete'):(de?'Auf dieser One-Seite · noch nicht in Atlas gespeichert':'On this One page · not yet saved in Atlas')}</strong></div>
     {artifact&&editable?<Suspense fallback={<p>{de?'Atlas-Aktionen werden geladen …':'Loading Atlas actions …'}</p>}><AtlasCard key={artifact.id+artifact.htmlHash} artifact={artifact} embedded savedCurrent={isSaved} onPersist={persist}/></Suspense>:<div><p>{de?'Designquelle: ':'Design source: '}<a href={spec.source} target="_blank" rel="noreferrer">{spec.source}</a></p><p>{de?'Requirements: ':'Requirements: '}{spec.requirement||(de?'Keine hinterlegt':'None supplied')}</p>{receipt&&<ul>{receipt.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} · #{source.ref}</a></li>)}</ul>}{preview.targetUrl&&<a href={preview.targetUrl} target="_blank" rel="noreferrer">{de?'Atlas-Record öffnen':'Open Atlas record'}</a>}{!receipt&&<p>{de?'Diese ältere Vorschau enthält keinen vollständigen Quellennachweis für die spätere Übertragung. Unter Notizen kannst du sie mit KI überarbeiten und die Designquelle neu lesen lassen. Übernimm danach das neue Ergebnis.':'This older preview lacks the source receipt needed for a later upload. Revise it with AI under Notes to read the design source again, then adopt the new result.'}</p>}</div>}
    </>}
    {preview&&<section className="mock-block__preview" hidden={tab==='atlas'||tab==='versions'||tab==='components'} contentEditable={false}><div className="mock-block__actions"><strong>{preview.title}</strong><label>{de?'Ansicht':'Viewport'} <select aria-label={de?'Geräteansicht':'Device viewport'} value={device} onChange={e=>setDevice(e.target.value)}><option value="original">Original</option><option value="desktop">Desktop · 1440</option><option value="tablet">Tablet · 768</option><option value="mobile">Mobil · 390</option></select></label>{editable&&<><label>{de?'Zustand':'State'} <select aria-label={de?'Neuer Mock-Zustand':'New mock state'} value={scenario} onChange={e=>setScenario(e.target.value)}><option value="empty">{de?'Leer':'Empty'}</option><option value="loading">{de?'Lädt':'Loading'}</option><option value="error">{de?'Fehler':'Error'}</option><option value="success">{de?'Erfolg':'Success'}</option></select></label><button type="button" className="btn btn--sm" onClick={()=>requestChange({path:'body',tag:'body',text:preview.title,component:'',requirement:'',snippet:''},'Erzeuge eine eigenständige Zustandsvariante dieses Mocks: '+scenario+'. Behalte Layout und Komponenten bei, soweit zum Zustand passend. Nutze vorhandene Katalogdefinitionen und kennzeichne fehlende Vorgaben. Benenne den Zustand im Titel. Die bisherige Version bleibt bis zur Annahme aktiv.',scenario)}>{de?'Zustand mit KI entwerfen':'Draft state with AI'}</button></>}{selectionTools}<button type="button" className="btn btn--sm" onClick={()=>setLarge(true)}>{t('editor.mock.fullscreen')}</button>{editable&&<button type="button" className="btn btn--sm" onClick={()=>change({...spec,preview:null})}>{t('editor.mock.remove')}</button>}</div><div className="mock-block__viewport">{previewFrame(!large)}</div><p className="faint">{t('editor.mock.snapshot')} · {preview.createdAt}</p></section>}
   </div>
  </section>}
  {inspected&&inspectedVersion&&<Modal open title={inspected.region?(de?'Markierter Bereich':'Marked area'):inspected.element.component||inspected.element.tag} width="calc(100vw - 24px)" className="mock-block-modal" onClose={()=>setInspected(null)}><p>{inspected.text}</p><div className="mock-block__actions">{!inspected.region&&mockNoteElements(inspected).map((e,i)=><button key={e.path} className="btn btn--sm" onClick={()=>setInspected({...inspected,element:e})}>{i+1}. {e.component||e.tag} · {e.text.slice(0,60)}</button>)}</div><div className="mock-block__viewport"><MockPreviewFrame document={safePreview(inspectedVersion.preview)} title="Marked mock version" width={inspected.region?.viewportWidth??inspectedVersion.preview.width} height={inspected.region?.viewportHeight??inspectedVersion.preview.height} marking={false} region={inspected.region} highlight={inspected.region?undefined:inspected.element.path} highlights={inspected.region?[]:mockNoteElements(inspected).map(e=>e.path)} onSelect={()=>{}}/></div></Modal>}
  {viewedVersion&&<Modal open title={'V'+viewedVersionNumber+' · '+viewedVersion.preview.title} width="calc(100vw - 24px)" className="mock-block-modal" onClose={()=>setViewedVersionKey(null)}><p>{viewedVersion.label} · {new Date(viewedVersion.at).toLocaleString()} · {viewedVersion.preview.width} × {viewedVersion.preview.height}</p><div className="mock-block__viewport"><MockPreviewFrame document={safePreview(viewedVersion.preview)} title={'V'+viewedVersionNumber+' · '+viewedVersion.preview.title} width={viewedVersion.preview.width} height={viewedVersion.preview.height} marking={false} onSelect={()=>{}}/></div></Modal>}
  {large&&preview&&<Modal open title={preview.title} width="calc(100vw - 24px)" className="mock-block-modal" onClose={()=>setLarge(false)}>{selectionTools}<div className="mock-block__viewport">{previewFrame(true)}</div></Modal>}
 </NodeViewWrapper>
}
export const designMockViewOptions={stopEvent:({event}:{event:Event})=>!event.type.startsWith('drag')&&event.type!=='drop'&&!!(event.target as Element|null)?.closest?.('.mock-block__composer,.mock-block__preview,.mock-block summary,.mock-block header,.mock-block__settings')}
