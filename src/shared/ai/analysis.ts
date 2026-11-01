/** Small source-bound BA draft followed by a PO critique. Checks are not semantic proof. */
export type AnalysisIntent={role:'ba'|'po';focus:string}
export type AnalysisRef={ref:string;quote:string}
export type BADraft={requirements:Array<{statement:string;source_refs:string[];checks:Array<{observation:string;conforms:boolean}>}>;questions:Array<{question:string;reason:string;source_refs:string[]}>}
export type POReview={reviews:Array<{requirement:string;support:'supported'|'partial'|'unsupported';check_support:'supported'|'partial'|'unsupported';finding:string}>;contradictions:Array<{left_ref:string;right_ref:string;reason:string}>;questions:string[]}
export function analysisIntent(goal:string):AnalysisIntent|null{const m=/^\/(ba|po)(?:\s+([\s\S]*))?$/iu.exec(goal.trim());return m?{role:m[1].toLowerCase() as 'ba'|'po',focus:(m[2]??'').trim()}:null}
const str=(min=1,max=1200)=>({type:'string',minLength:min,maxLength:max})
const arr=(items:unknown,min=0,max=3)=>({type:'array',minItems:min,maxItems:max,items})
const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
export function baSchema(refs:AnalysisRef[]){return obj({requirements:arr(obj({statement:str(20),source_refs:arr({type:'string',enum:refs.map(r=>r.ref)},1,3),checks:arr(obj({observation:str(15),conforms:{type:'boolean'}}),2,3)})),questions:arr(obj({question:str(10),reason:str(10),source_refs:arr({type:'string',enum:refs.map(r=>r.ref)},1,3)}),0,5)})}
export function poSchema(draft:BADraft,refs:AnalysisRef[]){return obj({reviews:arr(obj({requirement:{type:'string',enum:(draft.requirements.length?draft.requirements.map((_,i)=>'R'+(i+1)):['R-none'])},support:{type:'string',enum:['supported','partial','unsupported']},check_support:{type:'string',enum:['supported','partial','unsupported']},finding:str(15)}),draft.requirements.length,draft.requirements.length),contradictions:arr(obj({left_ref:{type:'string',enum:refs.map(r=>r.ref)},right_ref:{type:'string',enum:refs.map(r=>r.ref)},reason:str(15)})),questions:arr(str(10),0,5)})}
export function baIssues(draft:BADraft,refs:AnalysisRef[]):string[]{
 const issues:string[]=[]
 const source=refs.map(r=>r.quote).join('\n'),proposals=draft.requirements.map(r=>r.statement).join('\n')
 if(draft.requirements.length&&/\b(?:mit\s+(?:einem\s+)?Grund\s+und\s+(?:einem\s+)?Audit|with\s+(?:a\s+)?reason\s+and\s+(?:an?\s+)?audit)\b/iu.test(source)&&(!/\b(?:Grund|reason)\b/iu.test(proposals)||!/\baudit\b/iu.test(proposals)))issues.push('Preserve the explicit source obligation with reason AND audit in the requirement drafts; do not silently omit it.')
 if(!draft.requirements.length&&!draft.questions.length)issues.push('Return a grounded requirement or a specific missing-specification question; an empty analysis is not useful.')
 for(const r of draft.requirements){
  if(new Set(r.source_refs).size!==r.source_refs.length||r.source_refs.some(id=>!refs.some(x=>x.ref===id)))issues.push('Use distinct actual source references.')
  const evidence=r.source_refs.map(id=>refs.find(x=>x.ref===id)?.quote??'').join('\n')
  const response=r.statement.split(/\b(?:muss|soll|shall)\b/iu).slice(1).join(' ')
  if(/(?:ermöglich|erlaub|zulass|übernehmen|allow|permit|take\s*over)/iu.test(response)&&/(?:nur nachdem|only after)\s+(?:alle|sämtliche|all|every)\b/iu.test(evidence)&&! /\b(?:alle[nrms]?|sämtliche[nrms]?|all|every)\b/iu.test(r.statement))issues.push('Preserve the source prerequisite covering ALL associated items; do not weaken it to some items.')
  if(/bestätig|confirm/iu.test(response)&&!/bestätig|confirm/iu.test(evidence))issues.push('A confirmation response was invented. The source requires verification but does not state that the system confirms it. Preserve source obligations instead.')
  const reportError=/(?:fehler|error).{0,60}(?:meld|anzeig|report|display)|(?:meld|anzeig|report|display).{0,60}(?:fehler|error)/iu
  if(reportError.test(response)&&!reportError.test(evidence))issues.push('An error-reporting reaction was invented. A prerequisite does not specify an error message. Leave the reaction open and formulate the source invariant.')
  if(/capacity[- ]?409/iu.test(evidence)&&/\b409\b/u.test(r.statement)&&!/capacity|kapazit[äa]t/iu.test(r.statement))issues.push('Capacity-409 is a qualified conflict, not every HTTP 409. Preserve the capacity qualifier from the source.')
  if(/wiederhol|retry/iu.test(response)&&/benutzerbestätig|user.{0,30}confirm/iu.test(evidence)&&!/benutzerbestätig|(?:benutzer|anwender|user).{0,80}(?:bestätig|confirm)|(?:bestätig|confirm).{0,80}(?:benutzer|anwender|user)/iu.test(r.statement))issues.push('The source requires USER CONFIRMATION before retry. Preserve that prerequisite; do not authorize an automatic retry.')
  const numbers:string[]=evidence.match(/\b\d+(?:[.,]\d+)?\b/gu)??[]
  for(const number of r.statement.match(/\b\d+(?:[.,]\d+)?\b/gu)??[])if(!numbers.includes(number))issues.push('The requirement introduces an ungrounded number: '+number+'. Leave the threshold open instead.')
  if(/(?:muss|soll|shall)\b.{0,250}\bimplement(?:ier|\b)/iu.test(r.statement))issues.push('Describe the observable required response, not development work such as implementing a feature.')
  if(/[<>]|⟦b\d+⟧/u.test(r.statement))issues.push('Applied requirements must not contain placeholders or internal block labels.')
  if(new Set(r.checks.map(c=>c.observation.trim().toLowerCase())).size!==r.checks.length)issues.push('Provide different hypothetical observations under the SAME requirement condition.')
  if(r.checks.length&&(!r.checks.some(c=>c.conforms)||!r.checks.some(c=>!c.conforms)))issues.push('Include both a conforming and a violating observation under the SAME condition. Do not infer the inverse when a trigger is absent.')
 }
 for(const q of draft.questions)if(q.source_refs.some(id=>!refs.some(x=>x.ref===id)))issues.push('A missing-specification question must cite an actual source reference.')
 return issues
}
export function poIssues(review:POReview,draft:BADraft):string[]{
 const ids=draft.requirements.map((_,i)=>'R'+(i+1)),seen=review.reviews.map(r=>r.requirement)
 const issues=ids.some(id=>seen.filter(x=>x===id).length!==1)||seen.some(id=>!ids.includes(id))?['Review every proposed requirement exactly once.']:[]
 if(review.reviews.some(r=>(r.support!=='supported'||r.check_support!=='supported'))&&!review.questions.length)issues.push('A partial or unsupported requirement needs an actionable clarification question.')
 for(const c of review.contradictions)if(c.left_ref===c.right_ref)issues.push('A contradiction needs two distinct original passages. Missing information is a question, not a contradiction.')
 return issues
}
const cell=(s:string)=>s.replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ')
export function renderAnalysis(draft:BADraft,review:POReview,refs:AnalysisRef[],snapshot:{title:string;url:string;hash:string;readAt:string;partial:boolean;scope?:string},de:boolean):string{
 const quote=(ids:string[])=>ids.map(id=>{const r=refs.find(x=>x.ref===id);return r?`${id}: ${r.quote}`:'INVALID SOURCE'}).join(' · ')
 const labels=de?{title:'BA / PO · Anforderungen zur Prüfung',scope:'Gelesener ONE-Schnappschuss',notice:'Entwurf, keine Freigabe. Atlas wurde in diesem Prüflauf nicht erneut abgefragt. Quellenbezug und Struktur sind geprüft; die fachliche Ableitung und alle Entscheidungen bleiben beim Team.',req:'BA · Anforderungsentwürfe',tests:'Vorgeschlagene Prüffälle · nicht ausgeführt',po:'PO · zweite Modellprüfung, keine unabhängige Abnahme',gaps:'Offene Angaben und Entscheidungen',conflicts:'Mögliche Widersprüche · fachlich prüfen',status:'Entscheidung offen'}:{title:'BA / PO · requirements for review',scope:'Read ONE snapshot',notice:'Draft, not approval. Atlas was not queried again in this review. Origin and structure are checked; semantic derivation and all decisions remain with the team.',req:'BA · proposed requirements',tests:'Proposed checks · not executed',po:'PO · second model review, not independent acceptance',gaps:'Missing specifications and decisions',conflicts:'Possible contradictions · human review required',status:'Decision open'}
 const lines=[`# ${labels.title}`,labels.notice,`**${labels.scope}:** [${snapshot.title}](${snapshot.url}) · ${snapshot.readAt} · SHA-256 \`${snapshot.hash}\`${snapshot.partial?(de?' · nur ausgewählte Blöcke':' · selected blocks only'):''}`,...(snapshot.scope?[`**${de?'Ausschnitt':'Scope'}:** ${snapshot.scope}`]:[]),`## ${labels.req}`]
 const assessment=(v:'supported'|'partial'|'unsupported')=>de?({supported:'kein Einwand gefunden',partial:'Klärungsbedarf',unsupported:'Einwand'}[v]):({supported:'no issue found',partial:'clarification needed',unsupported:'objection'}[v])
 draft.requirements.forEach((r,i)=>{const po=review.reviews.find(p=>p.requirement==='R'+(i+1));lines.push(`### R${i+1} · ${labels.status}`,...(po?[`**PO · ${de?'Modelleinschätzung':'model assessment'}:** ${assessment(po.support)} · ${de?'Prüffälle':'checks'}: ${assessment(po.check_support)}`]:[]),r.statement,`> ${quote(r.source_refs)}`,`**${labels.tests}**`,de?'Annahme für diese Prüffälle: Die Anforderungsbedingung liegt vor. Die Beobachtungen sind hypothetisch.':'For these checks, assume the requirement condition holds. Observations are hypothetical.',...r.checks.map(c=>`- ${c.observation} → **${de?(c.conforms?'erfüllt die Anforderung':'verletzt die Anforderung'):(c.conforms?'conforms to the requirement':'violates the requirement')}**`))})
 if(!draft.requirements.length)lines.push(de?'Aus der gelesenen Quelle wurde keine ausreichend bestimmte Anforderung abgeleitet.':'No sufficiently specific requirement was derived from the read source.')
 lines.push(`## ${labels.po}`)
 if(!review.reviews.length)lines.push(de?'Keine Anforderungsentwürfe zur Gegenprüfung; offene Angaben stehen unten.':'No requirement drafts to critique; missing specifications are listed below.')
 else lines.push('| ID | '+(de?'Anforderung · Modelleinschätzung | Prüffälle · Modelleinschätzung | Befund':'Requirement · model assessment | Checks · model assessment | Finding')+' |','| --- | --- | --- | --- |')
 for(const r of review.reviews)lines.push(`| ${r.requirement} | ${de?({supported:'kein Einwand gefunden',partial:'Klärungsbedarf',unsupported:'Einwand'}[r.support]):r.support} | ${de?({supported:'kein Einwand gefunden',partial:'Klärungsbedarf',unsupported:'Einwand'}[r.check_support]):r.check_support} | ${cell(r.finding)} |`)
 lines.push(`## ${labels.gaps}`,...draft.questions.map(q=>`- ${q.question} — ${q.reason}\n  > ${quote(q.source_refs)}`),...review.questions.map(q=>'- '+q))
 if(!draft.questions.length&&!review.questions.length)lines.push(de?'Das Modell hat keine offenen Angaben benannt; das ist kein Vollständigkeitsnachweis.':'The model listed no gaps; this does not prove completeness.')
 if(review.contradictions.length)lines.push(`## ${labels.conflicts}`,...review.contradictions.map(c=>`- ${c.reason}\n  > ${quote([c.left_ref,c.right_ref])}`))
 return lines.join('\n\n')
}

/** A unique real Markdown heading owns its descendants until the next peer/ancestor. */
export function focusAnalysisRefs(refs:AnalysisRef[],focus:string):{refs:AnalysisRef[];scope:string}{
 const wanted=focus.trim(),escaped=wanted.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 if(!wanted)return {refs,scope:'page'}
 const pattern=new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'($|[^\\p{L}\\p{N}])','iu')
 let matches=refs.map((r,i)=>({i,heading:/^(#{1,6})\s+(.+)/u.exec(r.quote)})).filter(x=>x.heading&&pattern.test(x.heading[2]))
 const label=new RegExp('^(?:[A-Z][A-Z0-9]{1,10}-\\d+\\s+)?'+escaped+'($|[^\\p{L}\\p{N}])','iu'),primary=matches.filter(x=>label.test(x.heading![2].replace(/^\[/u,'')))
 if(primary.length)matches=primary
 if(matches.length===1){const {i,heading}=matches[0];let end=i+1;while(end<refs.length){const next=/^(#{1,6})\s+/u.exec(refs[end].quote);if(next&&next[1].length<=heading![1].length)break;end++}return {refs:refs.slice(i,end),scope:heading![2]}}
 if(/^(?:S\d+|[A-Z][A-Z0-9]{1,10}-\d+(?:\s+S\d+)?)$/iu.test(wanted))throw Error('The focus must match one actual source heading. Choose a unique section such as S9; missing or ambiguous identifiers cannot be resolved by model guesswork.')
 return {refs,scope:'page · topic: '+wanted}
}
