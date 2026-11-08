import {useSessionDraft} from './sessionDraft'
import {useLayoutEffect,useRef,useState} from 'react'

interface View {tab:string;query:string;filter:string;limit:number;scroll:number;resultQuery:string;resultLimit:number;resultsOpen:boolean;sourceQuery:string;sourceLimit:number;sourceChanged:boolean;journeyQuery:string;journeyLimit:number}
const fresh=():View=>({tab:'open',query:'',filter:'all',limit:40,scroll:0,resultQuery:'',resultLimit:12,resultsOpen:false,sourceQuery:'',sourceLimit:20,sourceChanged:false,journeyQuery:'',journeyLimit:20})
// Tab-private, scoped to the account, workspace and access configuration; expires after 24 hours.
const valid=(x:unknown):x is View=>!!x&&Object.entries(fresh()).every(([key,value])=>typeof (x as any)[key]===typeof value&&(typeof value!=='number'||Number.isFinite((x as any)[key])&&(x as any)[key]>=0))
export function useWorkOverviewView(scope:string){
 const [view,setView]=useSessionDraft('work-overview',fresh,valid)
 const [initial]=useState(view),root=useRef<HTMLDivElement>(null),latest=useRef(view)
 latest.current=view
 useLayoutEffect(()=>{
  const body=root.current?.closest<HTMLElement>('.modal__body')
  if(!body)return
  body.scrollTop=initial.scroll
  const save=()=>{setView({...latest.current,scroll:body.scrollTop})}
  body.addEventListener('scroll',save,{passive:true});save()
  return()=>{save();body.removeEventListener('scroll',save)}
 },[scope,initial])
 useLayoutEffect(()=>{
  const body=root.current?.closest<HTMLElement>('.modal__body')
  if(body)body.scrollTop=view.scroll
 },[scope,view])
 const change=(patch:Partial<View>)=>setView(v=>({...v,...patch,limit:40,scroll:0}))
 return {root,view,setResults:(patch:Partial<View>)=>setView(v=>({...v,...patch,scroll:root.current?.closest<HTMLElement>('.modal__body')?.scrollTop??0})),setTab:(tab:string)=>change({tab}),setQuery:(query:string)=>change({query}),setFilter:(filter:string)=>change({filter}),showMore:()=>setView(v=>({...v,limit:v.limit+40,scroll:root.current?.closest<HTMLElement>('.modal__body')?.scrollTop??0})),reset:()=>setView(fresh())}
}
