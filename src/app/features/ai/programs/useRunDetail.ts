import {useEffect,useState} from 'react'
import type {ProgramRunPreview} from '@/shared/quandprofile/program-run-summary'
import type {ProgramRun} from '@/shared/quandprofile/program'
import {getProgramRun,programScope} from './storage'
/** Fetch only after the person opens a run. An obsolete account/selection may never paint another receipt. */
export function useRunDetail(preview:ProgramRunPreview|undefined){
 const [loaded,setLoaded]=useState<{run:ProgramRun;scope:string}|null>(null),[failed,setFailed]=useState<{id:string;detail:string}|null>(null),[attempt,setAttempt]=useState(0),scope=programScope().key
 useEffect(()=>{let live=true;if(!preview?.summary)return
  setFailed(null)
  void getProgramRun(preview.id).then(run=>{if(live&&programScope().key===scope)setLoaded({run,scope})}).catch(error=>{if(live&&programScope().key===scope)setFailed({id:preview.id,detail:error instanceof Error?error.message:String(error)})})
  return()=>{live=false}
 },[preview?.id,preview?.summary,scope,attempt])
 const run=preview?.summary?loaded?.run.id===preview.id&&loaded.scope===scope&&scope===programScope().key?loaded.run:undefined:preview
 return{run,loading:!!preview&&!run,error:failed&&failed.id===preview?.id?failed.detail:'',retry:()=>setAttempt(n=>n+1)}
}
