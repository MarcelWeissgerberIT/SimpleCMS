import {useRef,useState,useEffect} from 'react'
import {SOURCE_DRAG,CARD_DRAG,QUESTION_DRAG,type Point} from './drag'
import {useLang} from '../../i18n'
import {levels,levelsEn,type Card,type Link} from './model'
export function Board({cards,links,resolvedIds,size,selected,readOnly,onSelect,onOpen,onMove,onDropOverview,onDropSource,onDropQuestion}:{cards:Card[];links:Link[];resolvedIds:string[];size:number;selected:string[];readOnly:boolean;onSelect:(id:string)=>void;onOpen:(id:string)=>void;onMove:(id:string,x:number,y:number)=>void;onDropOverview:(pageId:string,itemId:string,point:Point)=>void;onDropSource:(token:string,point:Point)=>void;onDropQuestion:(id:string)=>void}){
 const de=useLang()==='de',scale=(Math.max(44,size)+24)/280,host=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number}|null>(null)
 const width=Math.max(320,...cards.map(c=>c.x*scale+Math.max(44,size)+32)),height=Math.max(300,...cards.map(c=>c.y*scale+Math.max(44,size)+32)),byId=new Map(cards.map(c=>[c.id,c]))
 const [over,setOver]=useState(false)
 useEffect(()=>{const end=()=>setOver(false);window.addEventListener('dragend',end);return()=>window.removeEventListener('dragend',end)},[])
 const accepts=(types:readonly string[])=>types.some(t=>[CARD_DRAG,SOURCE_DRAG,QUESTION_DRAG,'application/x-one-overview'].includes(t))
 return <div className="wb-map" data-drop-active={over} ref={host} aria-label={de?'Kartenlandkarte':'Card map'} onDragOver={e=>{if(!readOnly&&accepts(e.dataTransfer.types)){e.preventDefault();e.dataTransfer.dropEffect=e.dataTransfer.types.includes(CARD_DRAG)?'move':'copy';setOver(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(false)}} onDrop={e=>{
  setOver(false);if(readOnly||!accepts(e.dataTransfer.types))return;e.preventDefault();e.stopPropagation()
  const id=e.dataTransfer.getData(CARD_DRAG),r=e.currentTarget.getBoundingClientRect(),offset=byId.has(id)?drag.current:null
  const point={x:Math.max(0,(e.clientX-r.left+e.currentTarget.scrollLeft-16-(offset?.x??0))/scale),y:Math.max(0,(e.clientY-r.top+e.currentTarget.scrollTop-16-(offset?.y??0))/scale)}
  if(byId.has(id)){onMove(id,point.x,point.y);return}
  const question=e.dataTransfer.getData(QUESTION_DRAG);if(question){onDropQuestion(question);return}
  const token=e.dataTransfer.getData(SOURCE_DRAG);if(token){onDropSource(token,point);return}
  try{const v=JSON.parse(e.dataTransfer.getData('application/x-one-overview'));if(typeof v.pageId==='string'&&typeof v.itemId==='string')onDropOverview(v.pageId,v.itemId,point)}catch{}
 }}>
  {!cards.length&&<div className="wb-board-empty"><span aria-hidden="true">＋</span><strong>{de?'Deine Arbeitsfläche':'Your workspace'}</strong><p>{de?'Ziehe eine Aussage aus den Quellen hierher.':'Drag a statement from the sources here.'}</p></div>}
  <div className="wb-world" style={{width,height}}>
   <svg className="wb-threads" width={width} height={height} aria-hidden="true">{links.map(l=>{const a=byId.get(l.a),b=byId.get(l.b);return a&&b?<line key={l.id} x1={a.x*scale+size/2+16} y1={a.y*scale+size/2+16} x2={b.x*scale+size/2+16} y2={b.y*scale+size/2+16} data-relation={l.relation} data-resolved={resolvedIds.includes(l.id)}/>:null})}</svg>
   {cards.map((c,i)=><div key={c.id} className="wb-map-card" style={{left:c.x*scale+16,top:c.y*scale+16,width:Math.max(size,44),minHeight:Math.max(size,44)}}>
    <button className="wb-card-hit" style={{width:Math.max(44,size),height:Math.max(44,size)}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)} draggable={!readOnly} aria-label={`${c.title} · ${(de?levels:levelsEn)[c.level]}`} title={c.title} onDragStart={e=>{const r=e.currentTarget.getBoundingClientRect();drag.current={x:e.clientX-r.left,y:e.clientY-r.top};e.dataTransfer.setData(CARD_DRAG,c.id);e.dataTransfer.effectAllowed='move'}} onDragEnd={()=>setOver(false)} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.altKey&&!readOnly&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();onMove(c.id,Math.max(0,c.x+(e.key==='ArrowRight'?280:e.key==='ArrowLeft'?-280:0)),Math.max(0,c.y+(e.key==='ArrowDown'?280:e.key==='ArrowUp'?-280:0)))}}}>
     <span className="wb-card" style={{width:size,height:size}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)}>
     {size>=32&&<span className="wb-number">{String(i+1).padStart(2,'0')}</span>}{size>=64&&<strong>{c.title}</strong>}{size>=256&&<span className="wb-card-context">{c.detail}</span>}{size>=128&&<small>{c.group||(de?levels:levelsEn)[c.level]}</small>}
     </span>
    </button>
    <input className="wb-card-pick" type="checkbox" aria-label={(de?'Auswählen: ':'Select: ')+c.title} checked={selected.includes(c.id)} onChange={()=>onSelect(c.id)}/>
   </div>)}
  </div>
 </div>
}
