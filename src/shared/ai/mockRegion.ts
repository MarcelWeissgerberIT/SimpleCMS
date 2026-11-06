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
