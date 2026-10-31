import {Server,ArrowRight} from 'lucide-react'
import {useWorkspace} from '../../../store/store'
import {useUI} from '../../../store/ui'
import {useLang} from '../../../i18n'
import {navigate} from '../../../lib/router'
import {SHARED_PREFIX} from '@/shared/ai/shared-model'
import {useSharedModels,sharedModels} from '../core/sharedModels'
import {SharedModelProbe} from './SharedModelProbe'
import './shared-model.css'

/** A prepared team service is not a model running on the viewing member's laptop. */
export function FrankfurtModelCard(){
 const ai=useWorkspace(s=>s.ai),lang=useLang(),tr=(de:string,en:string)=>lang==='de'?de:en
 useSharedModels()
 const pin=ai?.routes?.['*']?.find(r=>r.p==='local'&&r.m.startsWith(SHARED_PREFIX))
 if(!ai?.onboarding||!pin)return null
 const share=sharedModels().find(s=>SHARED_PREFIX+s.id===pin.m)
 const online=!!share?.enabled&&!!share.online
 const open=()=>{useUI.getState().closeModal();navigate({name:'page',id:ai.onboarding!.startPageId})}
 return <section className="model-share frankfurt-model screw-plate" data-testid="frankfurt-model-card">
  <header><span>§ FF · {tr('UNSER EIGENES MODELL','OUR OWN MODEL')}</span><h4><Server size={20} aria-hidden/> Atlas Flow · Frankfurt</h4><p>{tr('Selbst gehostet auf unserer Google-Cloud-VM in Frankfurt. Dieses Modell läuft nicht auf deinem Laptop.','Self-hosted on our Google Cloud VM in Frankfurt. This model does not run on your laptop.')}</p></header>
  <div className="model-share__body">
   <div className="frankfurt-model__state"><strong className="model-share__status" data-online={online}>{online?tr('ONLINE · BEREIT','ONLINE · READY'):tr('DERZEIT OFFLINE','CURRENTLY OFFLINE')}</strong><span className="label">{tr('WORKSPACE-STANDARD','WORKSPACE DEFAULT')}</span></div>
   <dl className="frankfurt-model__facts"><div><dt>{tr('Modell','Model')}</dt><dd>{share?.model??tr('Status wird geladen …','Loading status …')}</dd></div><div><dt>{tr('Standort','Location')}</dt><dd>Frankfurt · GCP · NVIDIA L4</dd></div><div><dt>{tr('Warteschlange','Queue')}</dt><dd>{share?`${share.queued} ${tr('wartend','waiting')}${share.running?' · '+tr('eine Anfrage läuft','one request running'):''}`:'—'}</dd></div></dl>
   <p>{tr('Unser lokales Modell als Team-Dienst: Text, strukturierte Antworten und ONE-/Atlas-Werkzeuge innerhalb deiner Rechte. ONE braucht dafür keinen zusätzlichen Modell-API-Key und für Atlas keinen lokalen Worker. Deine persönliche Atlas-Verbindung richtest du auf der Startseite ein.','Our local model as a team service: text, structured answers and ONE/Atlas tools within your permissions. ONE needs no extra model API key and Atlas needs no local worker. Set up your personal Atlas connection on the start page.')}</p>
   <p className="frankfurt-model__note">{tr('Eine Anfrage gleichzeitig. Bei Ausfall kein stiller Anbieterwechsel. Keine native Bildanalyse oder Bildgenerierung. Die Anzeige „0 $“ misst keine VM-Betriebskosten; der aktuelle Dienst läuft als zeitlich begrenzter Test.','One request at a time. No silent provider fallback. No native image analysis or generation. A “$0” usage display does not measure VM running costs; the current service is a time-limited trial.')}</p>
   <button type="button" className="btn btn--sm" onClick={open}>{tr('Zum persönlichen Atlas-Einstieg','Open personal Atlas setup')} <ArrowRight size={14}/></button>
   {share&&<SharedModelProbe share={share}/>}
  </div>
 </section>
}
