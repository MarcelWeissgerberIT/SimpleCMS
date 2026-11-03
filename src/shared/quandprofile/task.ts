import type {ReviewProfile} from './review-profile.ts'
import {atlasTransferChoice} from './atlas-transfer.ts'
import type {EvidenceQuantum,QuantumStatus} from './runtime.ts'
export type TaskContract={review_profile?:ReviewProfile;id:string;revision:number;goal:string;instruction_context:string;input_hash:string;scope_hash:string;source_pointers:string[];allowed_tools:string[];read_only:boolean;external_write:boolean;execute:boolean;authenticate?:boolean;requires_sources:boolean;search_one:boolean;search_atlas:boolean;output:'text'|'json';required_literals:string[];decisions:Array<{question:string;answer:string}>}
export type TaskEvidence={one_pages?:string[];atlas_records?:string[];typed_sources?:string[];typed_sources_current?:boolean;other_sources?:string[];source_reads:number;atlas_reads:number;one_checked:boolean;atlas_checked:boolean;staged_changes:number;issues:number;denied_actions:number;pending_decisions:number;scope_current:boolean;provider_checked:boolean;answer:string|null;human_accepted:boolean}
export type TaskPhase='compile'|'dispatch'|'question'|'result'
export type TaskEffect='read'|'stage'|'local_state'|'write'|'execute'|'authenticate'|'forbidden'
export type TaskRequest={contract:TaskContract;evidence:TaskEvidence;phase:TaskPhase;tool:string|null;effect:TaskEffect|null;target?:string|null}
export type TaskFinding={id:string;dimensions:string[];status:QuantumStatus;hard:boolean;detail:string}
export type TaskCompiled={protocol:'quandprofile.task.v1';contract_hash:string;request_hash:string;phase:TaskPhase;decision:'allow'|'block';contract:TaskContract;dimension_definitions:Array<{id:string;title:string}>;findings:TaskFinding[];quanta:EvidenceQuantum[];model_context:Record<string,unknown>}
export type TaskQuestion={id:string;question:string;options:Array<{label:string;effect:string}>;neededFor:string;sourceChecks:{one:boolean;atlas:boolean};state:'open'|'answered';answer?:string}
export type TaskReport={program?:{id:string;version:number;hash:string;runId:string};id:string;at:number;phase:'working'|'decision'|'ready'|'blocked'|'accepted';compiled:TaskCompiled;observations:Array<{area:string;tool:string;success:boolean;at:number}>;questions:TaskQuestion[];evidence:TaskEvidence}
export const taskEvidence=():TaskEvidence=>({source_reads:0,atlas_reads:0,one_checked:false,atlas_checked:false,staged_changes:0,issues:0,denied_actions:0,pending_decisions:0,scope_current:true,provider_checked:false,answer:null,human_accepted:false})

/** Only the trusted user instruction is inspected. Source text and model-proposed plans never grant capabilities. */
export function taskBoundaries(goal:string){
  if(atlasTransferChoice(goal))return {readOnly:false,externalWrite:true,execute:false,authenticate:false}
  // Quoted examples and negated actions never grant a remote capability.
  const text=goal.toLowerCase().replace(/["“„`][^"“”„`]*["”`]/g,'')
  const readOnly=/(?:nur (?:lesen|lesend)|rein lesend|read[ -]only|only read|do not (?:write|change)|nichts (?:anlegen|ändern|aendern)|keine (?:änderungen|aenderungen))/u.test(text)
  const negative=/(?<![\p{L}\p{N}_])(?:erstelle|erzeuge|lege|aktualisiere|ändere|aendere|speichere|kommentiere|verlinke|übertrage|uebertrage|create|update|save|replace)\s+(?:bitte\s+)?(?:nicht|keine?|not|nothing)\b/u.test(text)||/(?:\b(?:nicht|kein|keine|keinen|ohne)\b.{0,50}(?:anlegen|ändern|aendern|speichern|kommentier|verlink|übertrag|uebertrag|start|ausführen|ausfuehren)|\b(?:do not|don't|never)\b.{0,50}(?:write|change|create|update|save|start|execute|run))/u.test(text)
  const transfer=/^(?:bitte\s+)?mach(?:e)?\s+aus\s+(?:dieser|der)\s+seite\s+(?:in|nach)\s+atlas\b/u.test(text.trim())
  const externalWrite=!readOnly&&!negative&&(transfer||/(?:^|[.!?;]\s*|\b(?:und|and)\s+)(?:bitte\s+)?(?:erstelle|erzeuge|lege|aktualisiere|ändere|aendere|speichere|create|update|save|replace|kommentiere|verlinke|übertrage|uebertrage)\b/u.test(text.trim()))
  const execute=!readOnly&&!negative&&/(?:^|[.!?;]\s*|\b(?:und|and)\s+)(?:bitte\s+)?(?:starte|führe|fuehre|start|execute|run)\b/u.test(text.trim())
  return {readOnly,externalWrite,execute,authenticate:polarionAuthenticationRequested(goal)}
}


/** Explicit identity-only requests need a real identity read, not an unrelated content query. */
export function atlasIdentityTask(goal:string):boolean {
 const text=goal.normalize('NFKC').trim().replace(/\s+/gu,' ')
 // Every clause must stay inside identity/tenant inspection. A briefing, record query or other
 // follow-up keeps the normal content-read requirement, even after a successful whoami.
 const clauses=text.split(/[.!?;]+\s*|:\s+(?=rufe\b)/iu).map(c=>c.trim()).filter(Boolean)
 const identity=/^(?:atlas[ :]+)?(?:atlas_)?whoami$|^(?:who am i (?:in|on) atlas|wer bin ich (?:in|bei) atlas)$|^(?:prüfe|pruefe|check|verify|read|zeige|show) (?:bitte )?(?:nur )?(?:(?:meine|my) )?(?:persönliche |persoenliche |personal )?(?:(?:aj-|eh-)?atlas[- ](?:identität|identitaet|identity|verbindung|zugang)|(?:identität|identitaet|identity) (?:in|bei|on) atlas)$/iu
 const summary='(?:nenne|zeige) (?:kurz )?(?:die )?(?:bestätigte |bestaetigte )?(?:identität|identitaet)(?: und (?:den |die )?(?:zugänglichen |zugaenglichen )?tenants?)?'
 const call=new RegExp('^rufe atlas_whoami (?:über mcp |ueber mcp )?(?:tatsächlich |tatsaechlich )?auf(?: und '+summary+')?$','iu')
 const limited=/^(?:nur lesen|read[ -]only|keine änderungen|do not change anything|keine weiteren quellen lesen(?: und nichts ändern)?|nichts ändern)$/iu
 return clauses.length>0&&clauses.some(c=>identity.test(c)||call.test(c))&&clauses.every(c=>identity.test(c)||call.test(c)||limited.test(c)||new RegExp('^'+summary+'$','iu').test(c))
}

/** Narrow login intent from the human instruction, never from source text or a model plan. */
export function polarionAuthenticationRequested(goal:string){
 const text=goal.toLowerCase().replace(/["“„`][^"“”„`]*["”`]/g,'')
 const clauses=text.split(/[.!?;]\s*/u)
 return clauses.some(c=>! /\b(?:nicht|not|never|kein|keine)\b|\bohne\s+(?:anmeldung|login)\b/u.test(c)&&/^(?:bitte\s+)?(?:verbinde (?:bitte )?(?:(?:dich|mich) mit (?:meinem |dem )?polarion|(?:meinen? |den )?polarion[- ](?:zugang|anmeldung))|starte (?:bitte )?(?:die |meine )?polarion[- ](?:anmeldung|login)|connect (?:to |my |the )?polarion(?: access| sign[- ]in)?|start (?:my |the )?polarion (?:login|sign[- ]in))\b/u.test(c.trim()))
}
