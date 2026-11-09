import {useRef} from 'react'
import {useLang} from '../../i18n'
import {levels,levelsEn,type Card,type Link} from './model'
export function Board({cards,links,resolvedIds,size,selected,readOnly,onSelect,onOpen,onMove,onDropOverview}:{cards:Card[];links:Link[];resolvedIds:string[];size:number;selected:string[];readOnly:boolean;onSelect:(id:string)=>void;onOpen:(id:string)=>void;onMove:(id:string,x:number,y:number)=>void;onDropOverview:(pageId:string,itemId:string)=>void}){
 const de=useLang()==='de',scale=(Math.max(44,size)+24)/280,host=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number}|null>(null)
 const width=Math.max(320,...cards.map(c=>c.x*scale+Math.max(44,size)+32)),height=Math.max(300,...cards.map(c=>c.y*scale+Math.max(44,size)+32)),byId=new Map(cards.map(c=>[c.id,c]))
 return <div className="wb-map" ref={host} aria-label={de?'Kartenlandkarte':'Card map'} onDragOver={e=>{if(!readOnly){e.preventDefault();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{if(readOnly)return;e.preventDefault();const id=e.dataTransfer.getData('application/x-one-desk-card'),r=e.currentTarget.getBoundingClientRect();if(byId.has(id)){onMove(id,Math.max(0,(e.clientX-r.left+e.currentTarget.scrollLeft-16-(drag.current?.x??0))/scale),Math.max(0,(e.clientY-r.top+e.currentTarget.scrollTop-16-(drag.current?.y??0))/scale));return}try{const v=JSON.parse(e.dataTransfer.getData('application/x-one-overview'));if(typeof v.pageId==='string'&&typeof v.itemId==='string')onDropOverview(v.pageId,v.itemId)}catch{}}}>
  <div className="wb-world" style={{width,height}}>
   <svg className="wb-threads" width={width} height={height} aria-hidden="true">{links.map(l=>{const a=byId.get(l.a),b=byId.get(l.b);return a&&b?<line key={l.id} x1={a.x*scale+size/2+16} y1={a.y*scale+size/2+16} x2={b.x*scale+size/2+16} y2={b.y*scale+size/2+16} data-relation={l.relation} data-resolved={resolvedIds.includes(l.id)}/>:null})}</svg>
   {cards.map((c,i)=><div key={c.id} className="wb-map-card" style={{left:c.x*scale+16,top:c.y*scale+16,width:Math.max(size,44),minHeight:Math.max(size,44)}}>
    <button className="wb-card-hit" style={{width:Math.max(44,size),height:Math.max(44,size)}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)} draggable={!readOnly} aria-label={`${c.title} · ${(de?levels:levelsEn)[c.level]}`} title={c.title} onDragStart={e=>{const r=e.currentTarget.getBoundingClientRect();drag.current={x:e.clientX-r.left,y:e.clientY-r.top};e.dataTransfer.setData('application/x-one-desk-card',c.id);e.dataTransfer.effectAllowed='move'}} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.altKey&&!readOnly&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();onMove(c.id,Math.max(0,c.x+(e.key==='ArrowRight'?280:e.key==='ArrowLeft'?-280:0)),Math.max(0,c.y+(e.key==='ArrowDown'?280:e.key==='ArrowUp'?-280:0)))}}}>
     <span className="wb-card" style={{width:size,height:size}} data-size={size} data-level={c.level} data-selected={selected.includes(c.id)}>
     {size>=32&&<span className="wb-number">{String(i+1).padStart(2,'0')}</span>}{size>=64&&<strong>{c.title}</strong>}{size>=256&&<span className="wb-card-context">{c.detail}</span>}{size>=128&&<small>{c.group||(de?levels:levelsEn)[c.level]}</small>}
     </span>
    </button>
    <input className="wb-card-pick" type="checkbox" aria-label={(de?'Auswählen: ':'Select: ')+c.title} checked={selected.includes(c.id)} onChange={()=>onSelect(c.id)}/>
   </div>)}
  </div>
 </div>
}
