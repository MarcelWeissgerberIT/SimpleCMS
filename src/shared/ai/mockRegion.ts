/** A free rectangle belongs to one saved rendering, not to a guessed component. */
export interface MockRegionTarget {path:string;text:string;component:string;x:number;y:number;width:number;height:number}
export interface MockRegion {x:number;y:number;width:number;height:number;viewportWidth:number;viewportHeight:number;targets:MockRegionTarget[];totalTargets:number;scrolls:Array<{path:string;x:number;y:number}>}
const number=(v:unknown,max=1000000)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max
export function readMockRegion(raw:unknown):MockRegion|undefined{
 const r=raw as MockRegion
 if(!r||!['x','y','width','height'].every(k=>number(r[k as keyof MockRegion]))||r.width<4||r.height<4||!number(r.viewportWidth,10000)||!number(r.viewportHeight,10000)||r.viewportWidth<1||r.viewportHeight<1||!Array.isArray(r.targets)||r.targets.length>32||!Number.isSafeInteger(r.totalTargets)||r.totalTargets<r.targets.length||r.totalTargets>100000||!Array.isArray(r.scrolls)||r.scrolls.length>64)return
 const path=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=1200
 if(r.targets.some(t=>!t||!path(t.path)||typeof t.text!=='string'||t.text.length>160||typeof t.component!=='string'||t.component.length>160||!['x','y','width','height'].every(k=>number(t[k as keyof MockRegionTarget])))||r.scrolls.some(s=>!s||!path(s.path)||!number(s.x)||!number(s.y)))return
 return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:r.viewportWidth,viewportHeight:r.viewportHeight,totalTargets:r.totalTargets,targets:r.targets.map(t=>({path:t.path,text:t.text,component:t.component,x:t.x,y:t.y,width:t.width,height:t.height})),scrolls:r.scrolls.map(s=>({path:s.path,x:s.x,y:s.y}))}
}
export function mockRegionPath(el:Element){const parts:string[]=[];let n:Element|null=el;while(n&&n.tagName!=='BODY'){const siblings=[...(n.parentElement?.children??[])].filter(s=>s.tagName===n!.tagName);parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(n)+1)+')');n=n.parentElement}return 'body'+(parts.length?' > '+parts.join(' > '):'')}
/** Geometry and labels help the text model locate the rectangle. The full version remains authoritative. */
export function captureMockRegion(doc:Document,box:Pick<MockRegion,'x'|'y'|'width'|'height'>):MockRegion{
 const win=doc.defaultView!,targets:MockRegionTarget[]=[],scrolls:MockRegion['scrolls']=[];let totalTargets=0
 for(const el of doc.body.querySelectorAll<HTMLElement>('*')){
  if(el.scrollLeft||el.scrollTop){if(scrolls.length<64)scrolls.push({path:mockRegionPath(el),x:el.scrollLeft,y:el.scrollTop})}
  const rect=el.getBoundingClientRect(),x=rect.left+win.scrollX,y=rect.top+win.scrollY
  if(rect.width<=0||rect.height<=0||x>=box.x+box.width||x+rect.width<=box.x||y>=box.y+box.height||y+rect.height<=box.y)continue
  if(!el.matches('[data-ds-component],button,input,select,textarea,img,svg')&&el.children.length)continue
  if(['SCRIPT','STYLE','META'].includes(el.tagName)||win.getComputedStyle(el).visibility==='hidden')continue
  totalTargets++
  if(targets.length<32)targets.push({path:mockRegionPath(el),text:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,160),component:(el.closest('[data-ds-component]')?.getAttribute('data-ds-component')??'').slice(0,160),x:Math.max(0,x),y:Math.max(0,y),width:rect.width,height:rect.height})
 }
 return {...box,viewportWidth:win.innerWidth,viewportHeight:win.innerHeight,targets,totalTargets,scrolls}
}
