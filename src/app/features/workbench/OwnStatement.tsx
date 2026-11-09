import {useState} from 'react'
import {useLang} from '../../i18n'
import {addCard} from './actions'
export function OwnStatement({pageId,onClose,onError}:{pageId:string;onClose:()=>void;onError:(e:unknown)=>void}){
 const de=useLang()==='de',[title,setTitle]=useState(''),[detail,setDetail]=useState('')
 return <form className="wb-own-statement" aria-label={de?'Eigene Aussage erstellen':'Create own statement'} onSubmit={e=>{e.preventDefault();if(!title.trim())return;try{const text=detail.trim()||title.trim();addCard(pageId,{title:title.trim(),detail:text,source:{kind:'note',pageId,blockId:'',quote:text,signature:'',label:de?'Eigene Aussage':'Own statement'}});onClose()}catch(e){onError(e)}}}>
  <div><span className="label">{de?'DEIN GEDANKE':'YOUR THOUGHT'}</span><p>{de?'Festhalten, verbinden und in deine Präsentation ziehen. Eigene Aussagen beginnen als Vermutung.':'Capture it, connect it and drag it into your presentation. Own statements start as assumptions.'}</p></div>
  <label>{de?'Deine Aussage':'Your statement'}<input autoFocus required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} placeholder={de?'Was möchtest du festhalten?':'What would you like to capture?'}/></label><label>{de?'Details (optional)':'Details (optional)'}<textarea rows={2} maxLength={12000} value={detail} onChange={e=>setDetail(e.target.value)}/></label>
  <div><button className="btn" type="submit" disabled={!title.trim()}>{de?'Aussage hinzufügen':'Add statement'}</button> <button className="btn" type="button" onClick={onClose}>{de?'Abbrechen':'Cancel'}</button></div>
 </form>
}
