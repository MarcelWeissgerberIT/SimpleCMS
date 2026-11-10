/** Product templates: stable section ids, human labels and explicit model instructions. */
export const templateIds=['review','decision','conflicts','release','presentation'] as const
export type OverviewTemplate=typeof templateIds[number]
type Section={id:string;de:string;en:string;hint:string}
type Template={de:string;en:string;descriptionDe:string;descriptionEn:string;questionDe:string;questionEn:string;sections:Section[]}
export const templates:Record<OverviewTemplate,Template>={
 review:{de:'Review',en:'Review',descriptionDe:'Stand, Blocker und nächste Schritte.',descriptionEn:'Progress, blockers and next steps.',questionDe:'Wo stehen wir und was braucht Aufmerksamkeit?',questionEn:'Where do we stand and what needs attention?',sections:[
  {id:'metrics',de:'Kennzahlen',en:'Key figures',hint:'Only explicitly reported numbers with their units, scope and dates. Never count generated cards as project metrics.'},
  {id:'done',de:'Erledigt',en:'Completed',hint:'Explicitly completed work. Work awaiting confirmation belongs in pending, not here.'},
  {id:'pending',de:'Bestätigung ausstehend',en:'Awaiting confirmation',hint:'Items explicitly awaiting confirmation, acceptance or a decision.'},
  {id:'blocked',de:'Blockiert & Risiken',en:'Blocked & risks',hint:'Explicit blockers and risks; retain uncertainty.'},
  {id:'next',de:'Nächste Schritte',en:'Next steps',hint:'Supported next actions and remaining questions.'}]},
 decision:{de:'Entscheidung',en:'Decision',descriptionDe:'Optionen abwägen, Belege prüfen.',descriptionEn:'Weigh options and examine evidence.',questionDe:'Welche Entscheidung ist mit diesen Quellen begründbar?',questionEn:'Which decision can these sources support?',sections:[
  {id:'options',de:'Optionen',en:'Options',hint:'Only options actually mentioned in the source.'},
  {id:'pros',de:'Vorteile',en:'Benefits',hint:'Supported benefits, explicitly attributed to their option.'},
  {id:'cons',de:'Nachteile & Risiken',en:'Costs & risks',hint:'Supported drawbacks, explicitly attributed to their option.'},
  {id:'evidence',de:'Belege & offene Punkte',en:'Evidence & open points',hint:'Evidence limits and missing information.'},
  {id:'decision',de:'Entscheidungsstand',en:'Decision status',hint:'Distinguish recorded human decisions from recommendations and open decisions. Never approve a decision.'}]},
 conflicts:{de:'Widersprüche prüfen',en:'Check contradictions',descriptionDe:'Aussagen und Gegenbelege nebeneinander.',descriptionEn:'Examine claims and counter-evidence.',questionDe:'Welche Aussagen passen nicht zusammen und was klärt sie?',questionEn:'Which claims disagree and what would resolve them?',sections:[
  {id:'claims',de:'Aussagen',en:'Claims',hint:'Source claims with scope and dates.'},
  {id:'counter',de:'Gegenbelege',en:'Counter-evidence',hint:'Only source-supported counter-evidence. A difference in scope or time is not automatically a contradiction.'},
  {id:'limits',de:'Unklarheiten',en:'Uncertainties',hint:'Uncertainty, evidence limits, mismatched scope or dates.'},
  {id:'clarify',de:'So klären wir es',en:'How to clarify',hint:'Only supported clarification questions or next steps.'}]},
 release:{de:'Release planen',en:'Plan a release',descriptionDe:'Voraussetzungen, Risiken und Freigaben.',descriptionEn:'Prerequisites, risks and approvals.',questionDe:'Was fehlt noch für dieses Release?',questionEn:'What is still missing for this release?',sections:[
  {id:'scope',de:'Ziel & Umfang',en:'Goal & scope',hint:'Stated release goal, scope and exclusions.'},
  {id:'dependencies',de:'Voraussetzungen',en:'Prerequisites',hint:'Dependencies and prerequisites, retaining whether they are satisfied or open.'},
  {id:'risks',de:'Risiken',en:'Risks',hint:'Supported risks and uncertainties.'},
  {id:'approval',de:'Freigabestand',en:'Approval status',hint:'Distinguish explicit approvals from pending approvals. Never infer readiness from missing information.'},
  {id:'next',de:'Nächste Schritte',en:'Next steps',hint:'Supported next steps and questions.'}]},
 presentation:{de:'Präsentation',en:'Presentation',descriptionDe:'Kernaussage, Hauptpunkte und Ausblick.',descriptionEn:'Main message, key points and outlook.',questionDe:'Was soll das Publikum verstehen und mitnehmen?',questionEn:'What should the audience understand and take away?',sections:[
  {id:'points',de:'Hauptpunkte',en:'Key points',hint:'Up to three principal messages, concise and understandable.'},
  {id:'evidence',de:'Belege',en:'Evidence',hint:'Specific supporting evidence, numbers and their limits.'},
  {id:'outlook',de:'Ausblick',en:'Outlook',hint:'Supported next steps and open questions. Do not invent a call to action.'}]}
}
export const isTemplate=(x:unknown):x is OverviewTemplate=>templateIds.includes(x as OverviewTemplate)
export const sectionAllowed=(template:OverviewTemplate,section:unknown)=>section==='summary'||templates[template].sections.some(s=>s.id===section)
export function templateInstruction(id:OverviewTemplate){const t=templates[id];return `Use the ${t.en} template. Assign every card a section. Summary cards MUST have section summary; all other cards MUST use one of these sections: ${t.sections.map(s=>`${s.id}: ${s.hint}`).join('\n')}. Do not invent material to fill a section; leave it empty when unsupported. Every card still requires its own source and verbatim quotation. This template is a reading structure, not a factual assertion or approval.`}
