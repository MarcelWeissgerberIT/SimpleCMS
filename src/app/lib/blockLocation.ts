import {useMemo,useSyncExternalStore} from 'react'
import {navigate,pageHref,parseHash} from './router'
import './blockLocation.css'

/** Read-only view coordinates, scoped to one block. Opening a link never changes saved content. */
export interface BlockLocation {view?:string;revision?:string;item?:string}
const EVENT='one-block-location'
let serial=0
const token=(value:string|null)=>value&&value.length<=200&&!/[\u0000-\u001f]/.test(value)?value:undefined
export function blockLocationHref(page:string,block?:string,location?:BlockLocation){
 const href=pageHref(page,block)
 if(!block||!location)return href
 const [path,query]=href.split('?'),params=new URLSearchParams(query)
 for(const [key,value] of Object.entries(location))if(token(value))params.set('work-'+key,value!)
 return path+'?'+params.toString()
}
/** Preserve read-only subview coordinates when a block has moved to another page. */
export function relocatedBlockHref(page:string,block:string,hash:string){
 const route=parseHash(hash),params=new URLSearchParams(hash.split('?')[1]??'')
 if(route.name!=='page'||route.block!==block)return pageHref(page,block)
 params.set('b',block)
 return pageHref(page)+'?'+params.toString()
}
export function openBlockLocation(page:string,block?:string,location?:BlockLocation){
 const href=blockLocationHref(page,block,location)
 const same=window.location.hash===href
 navigate(href)
 // A second click on the same link must restore the view after the user switched tabs locally.
 if(same){serial++;window.dispatchEvent(new Event(EVENT))}
}
function subscribe(cb:()=>void){
 window.addEventListener('hashchange',cb);window.addEventListener(EVENT,cb)
 return()=>{window.removeEventListener('hashchange',cb);window.removeEventListener(EVENT,cb)}
}
const snapshot=()=>serial+' '+window.location.hash
export function useBlockLocation(page:string|null|undefined,block:string|undefined){
 const value=useSyncExternalStore(subscribe,snapshot,snapshot)
 return useMemo(()=>{
  const hash=value.slice(value.indexOf(' ')+1),route=parseHash(hash)
  if(!block||route.name!=='page'||route.id!==page||route.block!==block)return null
  const q=new URLSearchParams(hash.split('?')[1]??'')
  const view=token(q.get('work-view')),revision=token(q.get('work-revision')),item=token(q.get('work-item'))
  return view||revision||item?{view,revision,item,key:value}:null
 },[value,page,block])
}

export function focusBlockItem(root:HTMLElement|null,item?:string){
 const el=item?root?.querySelector<HTMLElement>('[data-work-item="'+CSS.escape(item)+'"]'):root
 el?.scrollIntoView({block:'start'});el?.focus({preventScroll:true})
 return !!el
}
