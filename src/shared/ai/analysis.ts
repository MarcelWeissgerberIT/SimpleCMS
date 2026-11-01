/** Small source-bound BA draft followed by a PO critique. Checks are not semantic proof. */
export type AnalysisIntent={role:'ba'|'po';focus:string}
export type AnalysisRef={ref:string;quote:string}
export type BADraft={requirements:Array<{statement:string;source_refs:string[];checks:Array<{action:string;expected:string}>}>;questions:Array<{question:string;reason:string;source_refs:string[]}>}
export type POReview={reviews:Array<{requirement:string;support:'supported'|'partial'|'unsupported';finding:string}>;contradictions:Array<{left_ref:string;right_ref:string;reason:string}>;questions:string[]}
export function analysisIntent(goal:string):AnalysisIntent|null{const m=/^\/(ba|po)(?:\s+([\s\S]*))?$/iu.exec(goal.trim());return m?{role:m[1].toLowerCase() as 'ba'|'po',focus:(m[2]??'').trim()}:null}
const str=(min=1,max=1200)=>({type:'string',minLength:min,maxLength:max})
const arr=(items:unknown,min=0,max=3)=>({type:'array',minItems:min,maxItems:max,items})
const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
export function baSchema(refs:AnalysisRef[]){return obj({requirements:arr(obj({statement:str(20),source_refs:arr({type:'string',enum:refs.map(r=>r.ref)},1,3),checks:arr(obj({action:str(10),expected:str(10)}),2,3)})),questions:arr(obj({question:str(10),reason:str(10),source_refs:arr({type:'string',enum:refs.map(r=>r.ref)},1,3)}),0,5)})}
export function poSchema(draft:BADraft,refs:AnalysisRef[]){return obj({reviews:arr(obj({requirement:{type:'string',enum:(draft.requirements.length?draft.requirements.map((_,i)=>'R'+(i+1)):['R-none'])},support:{type:'string',enum:['supported','partial','unsupported']},finding:str(15)}),draft.requirements.length,draft.requirements.length),contradictions:arr(obj({left_ref:{type:'string',enum:refs.map(r=>r.ref)},right_ref:{type:'string',enum:refs.map(r=>r.ref)},reason:str(15)})),questions:arr(str(10),0,5)})}
export function baIssues(draft:BADraft,refs:AnalysisRef[]):string[]{
 const issues:string[]=[]
 if(!draft.requirements.length&&!draft.questions.length)issues.push('Return a grounded requirement or a specific missing-specification question; an empty analysis is not useful.')
 for(const r of draft.requirements){
  if(new Set(r.source_refs).size!==r.source_refs.length||r.source_refs.some(id=>!refs.some(x=>x.ref===id)))issues.push('Use distinct actual source references.')
  const evidence=r.source_refs.map(id=>refs.find(x=>x.ref===id)?.quote??'').join('\n')
  if(/(?:ermöglich|erlaub|übernehmen|allow|permit|take\s*over)/iu.test(r.statement)&&/(?:nur nachdem|only after)\s+(?:alle|sämtliche|all|every)\b/iu.test(evidence)&&! /\b(?:alle|sämtliche|all|every)\b/iu.test(r.statement))issues.push('Preserve the source prerequisite covering ALL associated items; do not weaken it to some items.')
  const numbers:string[]=evidence.match(/\b\d+(?:[.,]\d+)?\b/gu)??[]
  for(const number of r.statement.match(/\b\d+(?:[.,]\d+)?\b/gu)??[])if(!numbers.includes(number))issues.push('The requirement introduces an ungrounded number: '+number+'. Leave the threshold open instead.')
  if(/[<>]|⟦b\d+⟧/u.test(r.statement))issues.push('Applied requirements must not contain placeholders or internal block labels.')
  if(new Set(r.checks.map(c=>c.action.trim().toLowerCase())).size!==r.checks.length)issues.push('Provide different test actions, including a boundary or negative case when the source has a prerequisite.')
 }
 for(const q of draft.questions)if(q.source_refs.some(id=>!refs.some(x=>x.ref===id)))issues.push('A missing-specification question must cite an actual source reference.')
 return issues
}
export function poIssues(review:POReview,draft:BADraft):string[]{
 const ids=draft.requirements.map((_,i)=>'R'+(i+1)),seen=review.reviews.map(r=>r.requirement)
 const issues=ids.some(id=>seen.filter(x=>x===id).length!==1)||seen.some(id=>!ids.includes(id))?['Review every proposed requirement exactly once.']:[]
 if(review.reviews.some(r=>r.support!=='supported')&&!review.questions.length)issues.push('A partial or unsupported requirement needs an actionable clarification question.')
 for(const c of review.contradictions)if(c.left_ref===c.right_ref)issues.push('A contradiction needs two distinct original passages. Missing information is a question, not a contradiction.')
 return issues
}
const cell=(s:string)=>s.replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ')
export function renderAnalysis(draft:BADraft,review:POReview,refs:AnalysisRef[],snapshot:{title:string;url:string;hash:string;readAt:string;partial:boolean},de:boolean):string{
 const quote=(ids:string[])=>ids.map(id=>{const r=refs.find(x=>x.ref===id);return r?`${id}: ${r.quote}`:'INVALID SOURCE'}).join(' · ')
 const labels=de?{title:'BA / PO · Anforderungen zur Prüfung',scope:'Gelesener ONE-Schnappschuss',notice:'Entwurf, keine Freigabe. Atlas wurde in diesem Prüflauf nicht erneut abgefragt. Quellenbezug und Struktur sind geprüft; die fachliche Ableitung und alle Entscheidungen bleiben beim Team.',req:'BA · Anforderungsentwürfe',tests:'Vorgeschlagene Prüffälle · nicht ausgeführt',po:'PO · zweite Modellprüfung, keine unabhängige Abnahme',gaps:'Offene Angaben und Entscheidungen',conflicts:'Mögliche Widersprüche · fachlich prüfen',status:'Entscheidung offen'}:{title:'BA / PO · requirements for review',scope:'Read ONE snapshot',notice:'Draft, not approval. Atlas was not queried again in this review. Origin and structure are checked; semantic derivation and all decisions remain with the team.',req:'BA · proposed requirements',tests:'Proposed checks · not executed',po:'PO · second model review, not independent acceptance',gaps:'Missing specifications and decisions',conflicts:'Possible contradictions · human review required',status:'Decision open'}
 const lines=[`# ${labels.title}`,labels.notice,`**${labels.scope}:** [${snapshot.title}](${snapshot.url}) · ${snapshot.readAt} · SHA-256 \`${snapshot.hash}\`${snapshot.partial?(de?' · nur ausgewählte Blöcke':' · selected blocks only'):''}`,`## ${labels.req}`]
 draft.requirements.forEach((r,i)=>{lines.push(`### R${i+1} · ${labels.status}`,r.statement,`> ${quote(r.source_refs)}`,`**${labels.tests}**`,...r.checks.map(c=>`- ${c.action} → ${c.expected}`))})
 if(!draft.requirements.length)lines.push(de?'Aus der gelesenen Quelle wurde keine ausreichend bestimmte Anforderung abgeleitet.':'No sufficiently specific requirement was derived from the read source.')
 lines.push(`## ${labels.po}`)
 if(!review.reviews.length)lines.push(de?'Keine Anforderungsentwürfe zur Gegenprüfung; offene Angaben stehen unten.':'No requirement drafts to critique; missing specifications are listed below.')
 else lines.push('| ID | '+(de?'Quellenstützung · Modelleinschätzung | Befund':'Source support · model assessment | Finding')+' |','| --- | --- | --- |')
 for(const r of review.reviews)lines.push(`| ${r.requirement} | ${de?({supported:'gestützt',partial:'teilweise gestützt',unsupported:'nicht gestützt'}[r.support]):r.support} | ${cell(r.finding)} |`)
 lines.push(`## ${labels.gaps}`,...draft.questions.map(q=>`- ${q.question} — ${q.reason}\n  > ${quote(q.source_refs)}`),...review.questions.map(q=>'- '+q))
 if(!draft.questions.length&&!review.questions.length)lines.push(de?'Das Modell hat keine offenen Angaben benannt; das ist kein Vollständigkeitsnachweis.':'The model listed no gaps; this does not prove completeness.')
 if(review.contradictions.length)lines.push(`## ${labels.conflicts}`,...review.contradictions.map(c=>`- ${c.reason}\n  > ${quote([c.left_ref,c.right_ref])}`))
 return lines.join('\n\n')
}
