import {useEffect,useId,useRef,useState} from 'react'
import {validateValue,type ProgramSpec} from '@/shared/quandprofile/program'
import {useWorkspace} from '../../../store/store'
import {useT,useLang} from '../../../i18n'
import {inspectProgramInputs,sourceParameter,sourcePageAvailable,simpleInputKind,nullableInput} from './inputModel'
const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return undefined}}
const objectFields=(raw:string):Record<string,string>=>{const value=parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).map(([key,value])=>[key,JSON.stringify(value)])):{}}
/** Schema-owned controls: free strings remain free; closed enums never become ad-hoc options. */
function InputControl({name,schema,raw,onChange,depth=0,required=false,showIssues=false}:{name:string;schema:Record<string,unknown>;raw:string;onChange:(raw:string)=>void;depth?:number;required?:boolean;showIssues?:boolean}){
 const t=useT(),lang=useLang(),id=useId(),kind=depth>1?'json':simpleInputKind(schema),value=parse(raw)
 const [fields,setFields]=useState(()=>objectFields(raw)),emitted=useRef<string|null>(null)
 useEffect(()=>{if(raw!==emitted.current)setFields(objectFields(raw))},[raw])
 const label=typeof schema.title==='string'?schema.title:name
 const hints:string[]=[]
 for(const [rule,key]of [['minLength','minLength'],['maxLength','maxLength'],['minimum','minimum'],['maximum','maximum'],['exclusiveMinimum','above'],['exclusiveMaximum','below']]as const)if(typeof schema[rule]==='number')hints.push(t('features.ai.program.input.hint.'+key,{value:schema[rule]}))
 if(schema.type==='integer')hints.push(t('features.ai.program.input.hint.integer'))
 if(typeof schema.pattern==='string')hints.push(t('features.ai.program.input.hint.pattern',{value:schema.pattern}))
 if(required)hints.push(t('features.ai.program.input.hint.required'))
 let invalid=false
 if(showIssues){try{if(!raw.trim()){invalid=required}else validateValue(value,schema,name)}catch{invalid=true}}
 const describedBy=typeof schema.description==='string'||hints.length?id+'-hint':undefined
 const a11y={'aria-describedby':describedBy,'aria-invalid':invalid||undefined,'aria-required':required||undefined}
 const nullAllowed=nullableInput(schema),nullValue=value===null
 const nullControl=nullAllowed&&kind!=='enum'&&kind!=='json'?<label className="program-input__null"><input type="checkbox" checked={nullValue} onChange={e=>onChange(e.target.checked?'null':'')}/>{t('features.ai.program.input.null')}</label>:null
 let field
 if(kind==='enum'||kind==='boolean'){
  const options=kind==='enum'?schema.enum as unknown[]:[true,false,...(nullAllowed?[null]:[])]
  field=<select id={id} {...a11y} value={raw.trim()} onChange={e=>onChange(e.target.value)}><option value="">{t('features.ai.program.input.choose')}</option>{options.map(option=><option key={JSON.stringify(option)} value={JSON.stringify(option)}>{option===true?t('features.ai.program.input.yes'):option===false?t('features.ai.program.input.no'):option===null?t('features.ai.program.input.null'):typeof option==='string'?option:JSON.stringify(option)}</option>)}</select>
 }else if(kind==='object'&&!nullValue){
  field=<div className="program-input__object">{Object.entries(schema.properties as Record<string,Record<string,unknown>>).map(([key,child])=><InputControl key={key} name={name+'.'+key} schema={child} raw={fields[key]??''} depth={depth+1} required={Array.isArray(schema.required)&&schema.required.includes(key)} showIssues={showIssues} onChange={next=>{
   const after={...fields,[key]:next};setFields(after)
   const output='{'+Object.entries(after).filter(([,value])=>value!=='').map(([key,value])=>JSON.stringify(key)+':'+value).join(',')+'}'
   emitted.current=output;onChange(output)
  }}/>)}</div>
 }else if(!nullValue&&kind==='string'){
  const text=typeof value==='string'?value:''
  field=(typeof schema.maxLength==='number'&&schema.maxLength>240||text.includes('\n'))?<textarea id={id} {...a11y} rows={3} value={text} onChange={e=>onChange(JSON.stringify(e.target.value))}/>:<input id={id} {...a11y} value={text} onChange={e=>onChange(JSON.stringify(e.target.value))}/>
 }else if(!nullValue&&kind==='number'){
  field=<input id={id} {...a11y} inputMode="decimal" value={lang==='de'?raw.replace('.',','):raw} onChange={e=>onChange(lang==='de'?e.target.value.replace(',','.'):e.target.value)}/>
 }else if(kind==='json')field=<textarea id={id} {...a11y} value={raw} onChange={e=>onChange(e.target.value)} rows={Math.min(8,Math.max(2,raw.split('\n').length))} spellCheck={false}/>
 return <div className="program-input"><label htmlFor={id}>{label}</label>{describedBy&&<small id={describedBy}>{[typeof schema.description==='string'?schema.description:'',...hints].filter(Boolean).join(' · ')}</small>}{field}{nullControl}</div>
}
export function ProgramInputs({spec,values,onChange,showIssues}:{spec:ProgramSpec;values:Record<string,string>;onChange:(key:string,value:string)=>void;showIssues:boolean}){
 const t=useT(),pages=useWorkspace(s=>s.pages),[advanced,setAdvanced]=useState(false),inspection=inspectProgramInputs(spec,values)
 return <section className="program-inputs" aria-label={t('features.ai.program.inputs')}>
  <div className="program-inputs__head"><h4>{t('features.ai.program.inputs')}</h4><button className="btn btn--sm" aria-pressed={advanced} onClick={()=>setAdvanced(v=>!v)}>{t(advanced?'features.ai.program.input.form':'features.ai.program.input.advanced')}</button></div>
  {Object.entries(spec.parameters).map(([key,definition])=>{
   const raw=values[key]??(Object.hasOwn(definition,'default')?JSON.stringify(definition.default):'')
   const issue=inspection.issues.find(i=>i.key===key),isSource=sourceParameter(spec,key),selected=parse(raw)
   return <div className="program-inputs__parameter" key={key} data-invalid={showIssues&&!!issue||undefined}>
    {advanced?<label className="programs__field"><strong>{key}</strong><textarea aria-label={key} value={raw} onChange={e=>onChange(key,e.target.value)} rows={Math.min(8,Math.max(2,raw.split('\n').length))} spellCheck={false}/></label>:isSource?<label className="programs__field">{t('features.ai.program.sourcePage')}<select aria-label={t('features.ai.program.sourcePage')} value={typeof selected==='string'?selected:''} onChange={e=>onChange(key,JSON.stringify(e.target.value||null))}><option value="">{t(nullableInput(definition.schema)?'features.ai.program.noPage':'features.ai.program.input.choose')}</option>{typeof selected==='string'&&!sourcePageAvailable(pages,selected)&&<option value={selected}>{t('features.ai.program.input.unavailable')} · {selected}</option>}{Object.values(pages).filter(p=>sourcePageAvailable(pages,p.id)).map(p=><option key={p.id} value={p.id}>{p.title||t('common.untitled')}</option>)}</select></label>:<InputControl name={key} schema={definition.schema} raw={raw} required={!Object.hasOwn(definition,'default')} showIssues={showIssues} onChange={next=>onChange(key,next)}/>}
    {showIssues&&issue&&<p className="program-input__error" role="alert">{t('features.ai.program.input.'+issue.kind,{field:key})}{issue.kind==='schema'&&<small>{issue.detail}</small>}</p>}
    {Object.hasOwn(definition,'default')&&raw!==JSON.stringify(definition.default)&&<button className="btn btn--sm" onClick={()=>onChange(key,JSON.stringify(definition.default))}>{t('features.ai.program.input.reset')}</button>}
   </div>
  })}
 </section>
}
