import type {MockRegion,MockRegionTarget} from '@/shared/ai/mockRegion'
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
