/** Optional value help. Nothing is selected, saved or fetched merely by opening it. */
import {useEffect,useId,useRef,useState,type InputHTMLAttributes,type KeyboardEvent as ReactKeyEvent,type RefObject} from 'react'
import {ChevronDown,Check} from 'lucide-react'
import {useT} from '../i18n'
import {Popover} from './Popover'
import './value-suggestions.css'

export type ValueSuggestion={value:string;label?:string;detail?:string}
type Field=HTMLInputElement|HTMLTextAreaElement
export function matchingSuggestions(options:readonly ValueSuggestion[],value:string){
 const unique=[...new Map(options.filter(o=>o.value.trim()).map(o=>[o.value,o])).values()]
 const q=value.trim().toLocaleLowerCase(),exact=unique.some(o=>o.value===value)
 return unique.filter(o=>!q||exact||(o.label??o.value).toLocaleLowerCase().includes(q)||o.value.toLocaleLowerCase().includes(q)).slice(0,12)
}
export function useValueSuggestions({value,options,onChoose,label,enabled=true}:{value:string;options:readonly ValueSuggestion[];onChoose:(value:string)=>void;label:string;enabled?:boolean}){
 const id=useId(),field=useRef<Field|null>(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1)
 const available=enabled&&options.some(o=>o.value.trim()),shown=open&&available,items=matchingSuggestions(options,value)
 const close=()=>{setOpen(false);setActive(-1)}
 useEffect(()=>{setActive(-1)},[value])
 // Consume the first Escape before an enclosing editor/dialog sees it. A second Escape keeps its normal meaning.
 useEffect(()=>{if(!shown)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();close();field.current?.focus({preventScroll:true})}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[shown])
 const pick=(option:ValueSuggestion)=>{onChoose(option.value);close();field.current?.focus({preventScroll:true})}
 const key=(e:ReactKeyEvent<Field>)=>{
  if(e.nativeEvent.isComposing)return false
  if(e.key==='ArrowDown'&&e.altKey){e.preventDefault();setOpen(true);setActive(-1);return true}
  if(!shown)return false
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(n=>items.length?(n+(e.key==='ArrowDown'?1:-1)+items.length)%items.length:-1);return true}
  if(e.key==='Enter'&&!e.shiftKey&&active>=0&&items[active]){e.preventDefault();e.stopPropagation();pick(items[active]);return true}
  if(e.key==='Tab')close() // Tab never replaces a person's free entry.
  return false
 }
 const attributes=available?{role:'combobox' as const,'aria-autocomplete':'list' as const,'aria-expanded':shown,'aria-controls':shown?id:undefined,'aria-activedescendant':shown&&items[active]?`${id}-${active}`:undefined}:{}
 return {id,field,open:shown,available,active,items,label,value,attributes,key,pick,close,toggle:()=>{setOpen(!shown);setActive(-1);field.current?.focus({preventScroll:true})}}
}
export function ValueSuggestions({control,hint}:{control:ReturnType<typeof useValueSuggestions>;hint?:string}){
 const t=useT()
 useEffect(()=>{if(control.open&&control.active>=0)document.getElementById(`${control.id}-${control.active}`)?.scrollIntoView({block:'nearest'})},[control.open,control.active,control.id])
 if(!control.available)return null
 return <>
  <button type="button" className="value-help__toggle" aria-label={t('common.values.show',{field:control.label})} title={t('common.values.shortcut')} aria-expanded={control.open} aria-controls={control.open?control.id:undefined} onMouseDown={e=>e.preventDefault()} onClick={control.toggle}><ChevronDown size={14} aria-hidden/></button>
  <Popover open={control.open} anchor={control.field.current} onClose={control.close} autoFocus={false} placement="bottom-start" matchWidth className="value-help__popover">
   <div className="value-help__heading label">{t('common.values.available')}</div>
   <div id={control.id} role="listbox" aria-label={t('common.values.list',{field:control.label})} className="value-help__list">
    {control.items.map((o,i)=><button type="button" role="option" tabIndex={-1} id={`${control.id}-${i}`} key={o.value} aria-selected={o.value===control.value} data-active={i===control.active} className="value-help__option" title={o.value} onMouseDown={e=>e.preventDefault()} onClick={()=>control.pick(o)}><span><strong>{o.label??o.value}</strong>{o.detail&&<small>{o.detail}</small>}{o.label&&o.label!==o.value&&<code>{o.value}</code>}</span>{o.value===control.value&&<Check size={14} aria-hidden/>}</button>)}
    {!control.items.length&&<p className="value-help__empty">{t('common.values.noMatch')}</p>}
   </div>
   <p className="value-help__hint">{hint??t('common.values.free')}</p>
  </Popover>
 </>
}

type SuggestedInputProps=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'list'> & {value:string;onValueChange:(value:string)=>void;options:readonly ValueSuggestion[];hint?:string}
/** Drop-in input: the caller still owns validation and persistence, including unknown values. */
export function SuggestedInput({value,onValueChange,options,hint,...props}:SuggestedInputProps){
 const control=useValueSuggestions({value,options,onChoose:onValueChange,label:props['aria-label']??props.placeholder??'',enabled:!props.disabled&&!props.readOnly&&props.type!=='password'})
 return <span className="value-help" data-help={control.available||undefined}>
  <input {...props} {...control.attributes} value={value} ref={control.field as RefObject<HTMLInputElement>} onChange={e=>onValueChange(e.target.value)} onKeyDown={e=>{if(!control.key(e))props.onKeyDown?.(e)}}/>
  <ValueSuggestions control={control} hint={hint}/>
 </span>
}
