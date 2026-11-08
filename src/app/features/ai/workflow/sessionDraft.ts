import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {mcpWorkScope} from '../core/localMcpWork'
import {looksLikeKey} from '@/shared/ai/keys'
const DAY=86400000
/** Private to this browser tab/account/workspace. Survives reload; never enters team sync. */
export function useSessionDraft<T>(id:string,fresh:()=>T,valid:(value:unknown)=>value is T){
 const scope=mcpWorkScope(),key='one-draft-v1:'+scope+':'+id
 const initial=useMemo(()=>{try{const raw=sessionStorage.getItem(key);if(raw&&raw.length<262144){const row=JSON.parse(raw);if(Date.now()>=row.at&&Date.now()-row.at<DAY&&valid(row.value))return row.value as T}}catch{}return fresh()},[key])
 const [state,setState]=useState({key,value:initial,saved:true})
 const value=state.key===key?state.value:initial
 const latest=useRef({key,value,saved:true});latest.current={key,value,saved:state.saved}
 const change=useCallback((next:T|((value:T)=>T))=>{
  if(scope!==mcpWorkScope())return
  const old=latest.current,value=typeof next==='function'?(next as (v:T)=>T)(old.key===key?old.value:initial):next
   let saved=false
   try{const raw=JSON.stringify({at:Date.now(),value});if(raw.length<262144&&!looksLikeKey(raw)){sessionStorage.setItem(key,raw);saved=true}}catch{}
   latest.current={key,value,saved};setState(latest.current)
 },[key,scope,initial])
 useEffect(()=>{if(state.key!==key||state.saved)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[key,state.key,state.saved])
 return [value,change,state.key===key?state.saved:true] as const
}
