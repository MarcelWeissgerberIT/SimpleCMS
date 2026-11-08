import {create} from 'zustand'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
import {codeAccessScope} from '../code-evidence'
import {isEffectivelyTrashed} from '../../store/selectors'

export interface CodeDraft {
  key:string
  page:string
  block:string
  title:string
  basis:string
  proposal:string
  instruction:string
  edits:Record<string,string>
  sources:{file:string;path:string;commit:string;lines:number[]}[]
}
// Private, tab-local working copies. Never put unpublished code in workspace sync or browser storage.
export const useCodeDrafts=create<{scope:string;entries:Record<string,CodeDraft>}>(()=>({scope:'',entries:{}}))
export const codeDraftScope=()=>JSON.stringify([codeAccessScope(),useCloud.getState().readOnly,useCloud.getState().role])
let stop:undefined|(()=>void)
export function forgetCodeDraft(key:string){
  const {entries}=useCodeDrafts.getState()
  if(!entries[key])return
  const next={...entries};delete next[key]
  useCodeDrafts.setState({entries:next})
  if(!Object.keys(next).length){stop?.();stop=undefined}
}
export function keepCodeDraft(scope:string,draft:CodeDraft){
  if(scope!==codeDraftScope()||useCloud.getState().readOnly)return false
  const current=useCodeDrafts.getState()
  // No silent eviction: the existing copies remain available to save or download.
  if(current.scope===scope&&!current.entries[draft.key]&&Object.keys(current.entries).length>=50)return false
  useCodeDrafts.setState({scope,entries:{...(current.scope===scope?current.entries:{}),[draft.key]:draft}})
  if(stop)return true
  const clear=()=>{
    if(useCodeDrafts.getState().scope===codeDraftScope()){
      const pages=useWorkspace.getState().pages
      for(const d of Object.values(useCodeDrafts.getState().entries))if(!pages[d.page]||isEffectivelyTrashed(pages,d.page))forgetCodeDraft(d.key)
      return
    }
    useCodeDrafts.setState({scope:'',entries:{}})
    stop?.();stop=undefined
  }
  const beforeUnload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''}
  const offWorkspace=useWorkspace.subscribe(clear),offCloud=useCloud.subscribe(clear)
  window.addEventListener('beforeunload',beforeUnload)
  stop=()=>{offWorkspace();offCloud();window.removeEventListener('beforeunload',beforeUnload)}
  return true
}

export function downloadCodeDraft(draft:CodeDraft){
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'one-unapplied-code-draft',...draft},null,2)],{type:'application/json'}))
  const link=document.createElement('a');link.href=url;link.download='one-unapplied-code-draft.json';link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
