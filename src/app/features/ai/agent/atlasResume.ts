import {taskBoundaries} from '../../../../shared/quandprofile/task.ts'
import type {AgentStep,AgentTurn} from './types'
/** Only offer an explicit continuation for writes proven not to have left ONE. */
export function canResumeAtlasWrite(turn:AgentTurn,steps:AgentStep[]){
 if(turn.status==='running'||turn.program||turn.contract?.program||! /\batlas\b/iu.test(turn.task)||!taskBoundaries(turn.task).externalWrite)return false
 const calls=steps.filter(s=>s.turn===turn.n&&s.mcp).map(s=>s.mcp!)
 return calls.some(c=>c.notExecuted&&['atlas_create','atlas_update','atlas_comment','atlas_attach','atlas_attach_link'].includes(c.tool))
  &&!calls.some(c=>!c.notExecuted&&(c.receipt?.effect==='write_accepted'||c.receipt?.effect==='queued'||['atlas_create','atlas_update','atlas_comment','atlas_attach','atlas_attach_link'].includes(c.tool)))
}
export const atlasResumeTask=(task:string)=>task+'\n\nSetze diesen konkreten Atlas-Auftrag mit dem vorbereiteten Inhalt und dem bisherigen Ziel fort. Prüfe zuerst den aktuellen Zielstand und die bisherigen Werkzeugbelege. Bereits bestätigte Ergebnisse überspringen; bei unklarem Schreibausgang zuerst durch Lesen klären. Lege den noch fehlenden Record genau einmal an beziehungsweise führe nur die ausdrücklich beauftragte Aktualisierung aus. Lies das Ergebnis zurück und verlinke die echte Atlas-Adresse auf der ursprünglichen ONE-Seite.'
