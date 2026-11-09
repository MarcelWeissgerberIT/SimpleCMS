import {useEffect,useId,useRef,useState,type CSSProperties,type ReactNode} from 'react'
import {safeLocalGet,safeLocalSet} from '@/shared/brand'
import {useLang} from '../../../i18n'
import {Tooltip} from '../../../ui/Tooltip'
import {kinds,type OverviewItem,type OverviewKind,type OverviewReview} from './model'
import './mini-cards.css'

const sizes=[8,16,32,64,128,256] as const
type Size=typeof sizes[number]
function savedSize(key:string):Size {
 const value=Number(safeLocalGet(key))
 return sizes.includes(value as Size)?value as Size:64
}

/** A view of the original overview items: no second copy, inferred status or model call. */
export function MiniCards({items,labels,preferenceKey,pageId,reviews,isTracked,renderItem}:{
 items:OverviewItem[];labels:Record<OverviewKind,string>;preferenceKey:string;pageId:string
 reviews?:Record<string,OverviewReview>;isTracked:(item:OverviewItem)=>boolean
 renderItem:(item:OverviewItem)=>ReactNode
}){
 const de=useLang()==='de',[size,setSize]=useState<Size>(()=>savedSize(preferenceKey))
 const [selectedId,setSelectedId]=useState<string|null>(null),detailId=useId(),sizeId=useId()
 const detailRef=useRef<HTMLDivElement>(null),triggers=useRef(new Map<string,HTMLButtonElement>())
 const selected=items.find(item=>item.id===selectedId)
 useEffect(()=>{setSize(savedSize(preferenceKey));setSelectedId(null)},[preferenceKey])
 useEffect(()=>{if(selectedId&&!selected)setSelectedId(null)},[selectedId,selected])
 useEffect(()=>{
  if(selected){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({block:'nearest'})}
 },[selected?.id])
 const close=()=>{setSelectedId(null);if(selectedId)triggers.current.get(selectedId)?.focus()}
 const level=size<=16?(de?'Signal':'Signal'):size===32?(de?'Nummer':'Number'):size===64?(de?'Titelausschnitt':'Title preview'):size===128?(de?'Titel':'Title'):(de?'Titel und Kontext':'Title and context')
 return <div className="mini-cards" data-size={size} style={{'--mini-size':`${size}px`} as CSSProperties}>
  <div className="mini-cards-toolbar">
   <label htmlFor={sizeId}>{de?'Kartengröße':'Card size'}<select id={sizeId} value={size} onChange={e=>{const next=Number(e.target.value) as Size;if(sizes.includes(next)){setSize(next);safeLocalSet(preferenceKey,String(next))}}}>{sizes.map(value=><option key={value} value={value}>{value} × {value} px</option>)}</select></label>
   <span className="mini-cards-level" aria-live="polite">{items.length} {de?'Karten':'cards'} · {level}</span>
  </div>
  <p className="overview-meta">{de?'Karte öffnen für den vollständigen Text, Quellen und Nachverfolgung. Kleine Ansichten zeigen Ausschnitte.':'Open a card for its full text, sources and follow-up. Small views show excerpts.'}</p>
  {selected&&<div className="mini-cards-detail" id={detailId} ref={detailRef} tabIndex={-1} role="region" aria-label={de?'Kartendetails':'Card details'}>
   <div className="mini-cards-detail-head"><span>{labels[selected.kind]}</span><button className="btn btn--sm btn--ghost" onClick={close}>{de?'Details schließen':'Close details'}</button></div>
   {renderItem(selected)}
  </div>}
  {!items.length&&<p className="overview-empty">{de?'Keine Karten für diese Filter.':'No cards match these filters.'}</p>}
  <div className="mini-cards-legend">{kinds.filter(kind=>items.some(item=>item.kind===kind)).map(kind=><span key={kind}><i data-kind={kind} aria-hidden="true"/>{labels[kind]} <span>{items.filter(item=>item.kind===kind).length}</span></span>)}</div>
  <div className="mini-cards-grid" role="group" aria-label={de?'Karten':'Cards'}>
     {items.map(item=>{
      const kind=item.kind
      const number=String(items.indexOf(item)+1).padStart(2,'0'),review=reviews?.[item.id],tracked=isTracked(item)
      const state=review?(review.state==='confirmed'?(de?'Festgehalten':'Recorded'):review.state==='deferred'?(de?'Zurückgestellt':'Deferred'):(de?'Rückfrage':'Question')):tracked?(de?'Nachverfolgt':'Tracked'):''
      const accessible=[number,item.title,labels[kind],state].filter(Boolean).join(' · ')
      return <Tooltip key={item.id} label={accessible}><button type="button" className="mini-card-trigger" draggable onDragStart={e=>{e.dataTransfer.setData('application/x-one-overview',JSON.stringify({pageId,itemId:item.id}));e.dataTransfer.effectAllowed='copy'}} ref={el=>{if(el)triggers.current.set(item.id,el);else triggers.current.delete(item.id)}} aria-label={accessible} aria-expanded={selectedId===item.id} aria-controls={selectedId===item.id?detailId:undefined} onClick={()=>setSelectedId(item.id)}>
       <span className="mini-card-face" data-kind={kind} data-tracked={tracked||undefined} aria-hidden="true">
        {size>=32&&<span className="mini-card-number">{number}{size>=128&&state&&<span>{state}</span>}</span>}
        {size>=64&&<span className="mini-card-title">{item.title}</span>}
        {size===256&&<span className="mini-card-context">{item.detail}</span>}
        {size>=128&&<span className="mini-card-foot">{size===256&&item.role?item.role:(de?'Details öffnen ↗':'Open details ↗')}</span>}
       </span>
      </button></Tooltip>
     })}
  </div>
 </div>
}
