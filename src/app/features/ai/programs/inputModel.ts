import {validateValue,bindInputs,programDigest,type ProgramSpec} from '../../../../shared/quandprofile/program.ts'
import type {Page} from '../../../store/types'
export type ParameterIssue={key:string;kind:'missing'|'json'|'schema';detail:string}
export function inspectProgramInputs(spec:ProgramSpec,raw:Record<string,string>){
 const values:Record<string,unknown>={},issues:ParameterIssue[]=[]
 for(const [key,definition]of Object.entries(spec.parameters)){
  if(!raw[key]?.trim()){
   if(!Object.hasOwn(definition,'default')){issues.push({key,kind:'missing',detail:''});continue}
   values[key]=definition.default
  }else try{values[key]=JSON.parse(raw[key])}catch{issues.push({key,kind:'json',detail:''});continue}
  try{programDigest(values[key]);validateValue(values[key],definition.schema,key)}catch(e){issues.push({key,kind:'schema',detail:e instanceof Error?e.message:String(e)})}
 }
 return {values,issues,bound:issues.length?null:bindInputs(spec,values)}
}
export function sourceParameter(spec:ProgramSpec,key:string){
 return spec.steps.some(step=>step.kind==='workflow'&&'input'in step.target&&step.target.input===key||step.kind==='tool'&&!step.server&&step.tool==='read_page'&&'object'in step.args&&step.args.object.id&&'input'in step.args.object.id&&step.args.object.id.input===key)
}
/** Scope only: actual current policy, contents and external access are checked by the normal run gate. */
export function sourcePageAvailable(pages:Record<string,Page>,id:string){
 const seen=new Set<string>();let p:Page|undefined=pages[id]
 if(!p)return false
 while(p){if(seen.has(p.id)||p.trashed||p.template||p.hidden)return false;seen.add(p.id);if(p.parentId&&!pages[p.parentId])return false;p=p.parentId?pages[p.parentId]:undefined}
 return true
}
export function simpleInputKind(schema:Record<string,unknown>):'enum'|'string'|'number'|'boolean'|'object'|'json'{
 if(schema.anyOf||schema.oneOf||schema.allOf||schema.const!==undefined)return 'json'
 if(Array.isArray(schema.enum)&&schema.enum.length&&schema.enum.length<=100)return 'enum'
 const kinds=(Array.isArray(schema.type)?schema.type:[schema.type]).filter(t=>t!=='null')
 if(kinds.length!==1)return 'json'
 if(kinds[0]==='integer'||kinds[0]==='number')return 'number'
 if(['string','boolean'].includes(String(kinds[0])))return kinds[0] as 'string'|'boolean'
 if(kinds[0]==='object'&&schema.properties&&typeof schema.properties==='object'&&!Array.isArray(schema.properties)&&Object.keys(schema.properties).length<=12)return 'object'
 return 'json'
}
export const nullableInput=(schema:Record<string,unknown>)=>Array.isArray(schema.type)&&schema.type.includes('null')
