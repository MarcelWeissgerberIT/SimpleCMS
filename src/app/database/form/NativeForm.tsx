import {useEffect,useId,useRef,useState} from 'react'
import {teamRequest} from '../../cloud'
import {useT} from '../../i18n'
import {FormFill} from './FormFill'
import type {Field} from './fields'
import './form.css'
export default function NativeForm({token}:{token:string}){
 const t=useT(),id=useId(),delivery=useRef(crypto.randomUUID()),[form,setForm]=useState<{title:string;description:string;fields:Field[]}|null>(null),[error,setError]=useState('')
 useEffect(()=>{let live=true;setForm(null);setError('');void teamRequest<typeof form>('GET',`api/public-forms/${encodeURIComponent(token)}`).then(f=>{if(live)setForm(f)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[token])
 return <div className="pf"><main className="pf__main"><div className="pf__sheet">{error?<p role="alert">{t('team.formUnavailable')} · {error}</p>:!form?<p role="status">{t('team.loading')}</p>:<FormFill fields={form.fields} title={form.title} description={form.description} shared idBase={id} headingLevel={1} submitLabel={t('team.submit')} footnote={t('team.directFormDestination')} onSubmit={async answers=>{try{await teamRequest('POST',`api/public-forms/${encodeURIComponent(token)}`,{delivery:delivery.current,answers});delivery.current=crypto.randomUUID();return {ok:true}}catch(e){return {ok:false,message:String(e)}}}}/>}</div></main></div>
}
