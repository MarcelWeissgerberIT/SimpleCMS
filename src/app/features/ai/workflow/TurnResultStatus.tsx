import {useAgent} from '../agent/state'
import type {AgentTurn} from '../agent/types'
import {useLang} from '../../../i18n'
import {ResultProgress} from './ResultProgress'
export function TurnResultStatus({turn}:{turn:AgentTurn}){
 const de=useLang()==='de',steps=useAgent(s=>s.steps),changes=useAgent(s=>s.changes)
 const ids=new Set(steps.filter(s=>s.turn===turn.n).map(s=>s.changeId));if(turn.answerPageChange)ids.add(turn.answerPageChange)
 const own=changes.filter(c=>ids.has(c.id)),pending=own.filter(c=>['pending','failed','applying'].includes(c.status)).length,applied=own.filter(c=>c.status==='applied').length
 const running=turn.status==='running',blocked=['error','stopped','limit'].includes(turn.status),waiting=turn.contract?.phase==='decision'
 return <ResultProgress phase={waiting?'review':running?'working':pending?'review':applied?'adopted':turn.answer?'proposal':'working'} blocked={blocked}
 saved={own.length?(de?`${applied} Änderungen übernommen; ${pending} noch offen.`:`${applied} changes applied; ${pending} still open.`):(de?'Antwort und Laufstand im Terminal. Eine Speicherung als Seite ist eine eigene Aktion.':'Answer and run state in the terminal. Saving as a page is a separate action.')}
 next={waiting?(de?'Die offene Rückfrage beantworten.':'Answer the open question.'):running?(de?'Aktive Arbeit verfolgen; du kannst währenddessen andere Seiten öffnen.':'Follow active work; you can open other pages meanwhile.'):blocked?(de?'Fehler und erhaltenen Arbeitsstand prüfen, dann gezielt fortsetzen.':'Review the error and retained checkpoint, then resume deliberately.'):pending?(de?'Vorgeschlagene Unterschiede prüfen und einzeln übernehmen.':'Review proposed differences and apply them individually.'):applied?(de?'Ergebnis auf der Zielseite prüfen. Externe Übernahmen stehen im jeweiligen Nachweis.':'Inspect the target page. External deliveries have their own receipts.'):(de?'Antwort prüfen; bei Bedarf als Seite vorbereiten und übernehmen.':'Review the answer; prepare and adopt it as a page if needed.')}/>
}
