import {useLayoutEffect,useRef,useState} from 'react'

interface View {tab:string;query:string;filter:string;limit:number;scroll:number}
const fresh=():View=>({tab:'open',query:'',filter:'all',limit:40,scroll:0})
// Only the last view, in this tab's memory. Never synced, written to disk or shared across access scopes.
let remembered:{scope:string;view:View}|undefined
export function useWorkOverviewView(scope:string){
 const [initial]=useState(()=>remembered?.scope===scope?{...remembered.view}:fresh())
 const [view,setView]=useState(initial),root=useRef<HTMLDivElement>(null),latest=useRef(view)
 latest.current=view
 useLayoutEffect(()=>{
  const body=root.current?.closest<HTMLElement>('.modal__body')
  if(!body)return
  body.scrollTop=initial.scroll
  const save=()=>{remembered={scope,view:{...latest.current,scroll:body.scrollTop}}}
  body.addEventListener('scroll',save,{passive:true});save()
  return()=>{save();body.removeEventListener('scroll',save)}
 },[scope,initial])
 useLayoutEffect(()=>{
  const body=root.current?.closest<HTMLElement>('.modal__body')
  if(body)body.scrollTop=view.scroll
  remembered={scope,view:{...view}}
 },[scope,view])
 const change=(patch:Partial<View>)=>setView(v=>({...v,...patch,limit:40,scroll:0}))
 return {root,view,setTab:(tab:string)=>change({tab}),setQuery:(query:string)=>change({query}),setFilter:(filter:string)=>change({filter}),showMore:()=>setView(v=>({...v,limit:v.limit+40,scroll:root.current?.closest<HTMLElement>('.modal__body')?.scrollTop??0})),reset:()=>setView(fresh())}
}
