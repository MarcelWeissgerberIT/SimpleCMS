import type {TaskQuestion,TaskReport} from '@/shared/quandprofile/task'

/** Prepare current human input, never replay a closed tool transcript or reuse its permissions/evidence. */
export function decisionRecoveryPrompt(report:TaskReport,question:TaskQuestion,answer:string):string{
 if(!answer.trim()||answer.length>4000||!report.questions.some(q=>q.id===question.id&&q.state==='open'))throw Error('Invalid decision recovery')
 const c=report.compiled.contract
 return [c.read_only?'Read-only: do not write or change anything.':'',c.goal,
  'Human clarification for the prerequisite below (current user input, not tool evidence or additional permissions):',
  JSON.stringify({question:question.question,neededFor:question.neededFor,answer:answer.trim()}),
  'This is a new run after a closed request. Read the relevant current sources and target bodies/comments again. Earlier source checks, decisions, approvals and writes are historical, not fresh evidence or permission. Check existing results before any write; do not blindly repeat previous writes. Apply the current human clarification within the original task scope.',
  'Previously read source identifiers, for locating current content only: '+JSON.stringify({one:report.evidence.one_pages??[],atlas:report.evidence.atlas_records??[]})
 ].filter(Boolean).join('\n\n')
}
