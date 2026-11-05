import {MOCK_SCHEMA,type DesignMock} from './designMock.ts'
import {validateValue} from '../quandprofile/program.ts'
export type MockProvenance=Pick<DesignMock,'id'|'sources'|'draft'|'target'|'atlasContext'|'atlasDestination'|'atlasSaved'|'request'>
const url=(s:unknown)=>{try{const u=new URL(String(s));if(u.protocol!=='https:'||u.username||u.password)return '';u.search='';u.hash='';return u.href}catch{return ''}}
const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
/** Persist a bounded, explicit source receipt, never connection settings or arbitrary artifact fields. */
export function mockProvenance(raw:unknown):MockProvenance|undefined{
 try{
  const a=raw as DesignMock
  if(!a||JSON.stringify(a).length>180000||typeof a.id!=='string'||! /^[a-zA-Z0-9-]{1,80}$/.test(a.id)||!Array.isArray(a.sources)||!a.sources.length||a.sources.length>24)return
  validateValue({...a.draft,html:'<main>Static design mock preview</main>',css:''},MOCK_SCHEMA,'mock receipt')
  const sources=a.sources.map(s=>{
   if(!Number.isSafeInteger(s.ref)||s.ref<1||!url(s.url)||!hash(s.hash)||!hash(s.stateHash)||![s.id,s.server,s.title,s.readAt].every(x=>typeof x==='string'&&x.length>0&&x.length<=300))throw Error('Invalid source receipt')
   return {id:s.id,server:s.server,ref:s.ref,url:url(s.url),title:s.title,hash:s.hash,stateHash:s.stateHash,readAt:s.readAt}
  })
  const draft=Object.fromEntries(Object.keys(MOCK_SCHEMA.properties).filter(k=>k!=='html'&&k!=='css').map(k=>[k,(a.draft as any)[k]])) as DesignMock['draft']
  if([draft.design,...draft.requirements,...draft.tokens,...draft.components,...(draft.authority?[draft.authority]:[])].some(c=>!sources.some(s=>s.id===c.source)))return
  const destination=(v:DesignMock['atlasSaved'])=>v&&Number.isSafeInteger(v.ref)&&v.ref>0&&url(v.url)?{ref:v.ref,url:url(v.url)}:undefined
  const c=a.atlasContext,atlasContext=c&&Number.isSafeInteger(c.ref)&&c.ref>0&&url(c.url)&&typeof c.project==='string'&&c.project.length<=200&&typeof c.title==='string'&&c.title.length<=300&&/^ui-package:[a-z0-9][a-z0-9-]{0,49}$/.test(c.tag)?{ref:c.ref,url:url(c.url),project:c.project,title:c.title,tag:c.tag}:undefined
  return {id:a.id,sources,draft,target:sources.find(s=>s.id===draft.target)??null,atlasContext,atlasDestination:destination(a.atlasDestination),atlasSaved:destination(a.atlasSaved),request:typeof a.request==='string'?a.request.slice(0,8000):undefined}
 }catch{return}
}
export const mockColorToken=(value:string)=>/^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/+-]+\)|white|black|red|green|blue|gray|grey|transparent)$/i.test(value)
export function mockColors(raw:unknown,provenance?:MockProvenance):Record<string,string>{
 if(!raw||typeof raw!=='object')return {}
 return Object.fromEntries(Object.entries(raw).filter(([name,value])=>/^--[a-z][a-z0-9-]{1,60}$/.test(name)&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)&&provenance?.draft.tokens.some(t=>t.name===name&&mockColorToken(t.value))))
}
export function mockColorStyle(colors:Record<string,string>):string{
 const entries=Object.entries(colors).filter(([name,value])=>/^--[a-z][a-z0-9-]{1,60}$/.test(name)&&/^#[0-9a-f]{6}$/i.test(value))
 return entries.length?'<style>:root{'+entries.map(([name,value])=>name+':'+value).join(';')+'}</style>':''
}
