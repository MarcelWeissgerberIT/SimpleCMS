import {useMemo,useState} from 'react'
import DOMPurify from 'dompurify'
import {MockPreviewFrame} from './MockPreviewFrame'
import {mockBlockFrame,type MockBlockPreview} from '@/shared/ai/mockBlock'
import {mockColorStyle} from '@/shared/ai/mockBlockProvenance'
export function safeMockPreview(p:MockBlockPreview){return mockBlockFrame(DOMPurify.sanitize(p.document,{WHOLE_DOCUMENT:true,ADD_TAGS:['style'],FORBID_TAGS:['meta','base','script','link','iframe','object','embed','form'],FORBID_ATTR:['src','srcset','action','formaction','href','poster','background']})+mockColorStyle(p.colors??{}))}
export function mockVisualChanges(before:string,after:string){
 const read=(html:string)=>{const doc=new DOMParser().parseFromString(html,'text/html');return [...doc.body.querySelectorAll('[data-ds-component]')].map((e,i)=>({name:e.getAttribute('data-ds-component')!,text:e.outerHTML,path:'[data-ds-component]:nth-of-type('+i+')'}))}
 const a=read(before),b=read(after),names=[...new Set([...a,...b].map(e=>e.name))]
 const changed=names.filter(name=>JSON.stringify(a.filter(e=>e.name===name).map(e=>e.text))!==JSON.stringify(b.filter(e=>e.name===name).map(e=>e.text)))
 const styles=(html:string)=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('style')].map(s=>s.textContent).join('\n')
 return changed.length?changed:styles(before)!==styles(after)?names:[]
}
export function MockComparison({before,after,de}:{before:MockBlockPreview;after:MockBlockPreview;de:boolean}){
 const changes=useMemo(()=>mockVisualChanges(safeMockPreview(before),safeMockPreview(after)),[before,after]),[selected,setSelected]=useState('')
 const selector=selected?'[data-ds-component="'+CSS.escape(selected)+'"]':''
 return <section className="mock-comparison">
  <p>{de?'Geänderte Komponenten':'Changed components'}: {changes.length?changes.join(', '):(de?'Keine Strukturänderung; Farben und Darstellung vergleichen.':'No structural changes; compare colours and appearance.')}</p>
  <div className="mock-block__actions">{changes.map(name=><button type="button" className="btn btn--sm" key={name} aria-pressed={name===selected} onClick={()=>setSelected(name)}>{name}</button>)}</div>
  <div className="mock-comparison__columns">{[[de?'Vorher':'Before',before],[de?'Vorschlag':'Proposal',after]].map(([label,p])=>{const preview=p as MockBlockPreview;return <div key={String(label)}><h4>{String(label)}</h4><div className="mock-block__viewport"><MockPreviewFrame document={safeMockPreview(preview)} title={String(label)} width={preview.width} height={preview.height} marking={false} highlight={selector} onSelect={()=>{}}/></div></div>})}</div>
 </section>
}
