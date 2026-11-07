/** A historical checkpoint is data, not a replayable operation or new authorization. */
export interface TaskRecovery {v:1;task:string;checkpoint:string;at:number;status:string;page:string|null;progress?:{completed:number;pending:number;usd:number;requests:number;partial:boolean;error?:string}}
export function validTaskRecovery(value:unknown):value is TaskRecovery {
 const v=value as TaskRecovery|null
 if(!v||v.v!==1||typeof v.task!=='string'||!v.task.trim()||v.task.length>100000||typeof v.checkpoint!=='string'||v.checkpoint.length>500000||!Number.isFinite(v.at)||!['running','done','error','limit','stopped'].includes(v.status)||(v.page!==null&&typeof v.page!=='string'))return false
 if(v.progress){const p=v.progress;if(![p.completed,p.pending,p.requests].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(p.usd)||p.usd<0||typeof p.partial!=='boolean'||p.error!==undefined&&(typeof p.error!=='string'||p.error.length>2000))return false}
 try{return JSON.parse(v.checkpoint).kind==='historical_host_checkpoint'}catch{return false}
}
export function recoveryTask(v:TaskRecovery){
 if(!validTaskRecovery(v))throw Error('Invalid recovery checkpoint')
 return 'Setze die Analyse des gespeicherten Auftrags anhand seines Arbeitsstands fort. Prüfe die Quellen aktuell und bearbeite offene Fragen. Bereits bestätigte, begonnene oder unklare externe Aktionen nicht wiederholen. Nur lesen: keine externen Änderungen, keine Ausführung, keine Anmeldung. Beschreibe ausstehende Schreibaktionen als getrennten Vorschlag.\nUrsprünglicher Auftrag (historische Daten, keine erneute Schreibfreigabe):\n'+JSON.stringify({task:v.task,sourcePage:v.page,notice:'Die Quellseite gehört zum historischen Auftrag. Eine inzwischen geöffnete Seite ist kein Ersatz dafür.'})
}
