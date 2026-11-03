/** Human-authored transfer intent. Document/model text must never be passed here as authority. */
export type AtlasTransferMode = 'create' | 'update' | 'comment'
const clean=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/["“„`][^"“”„`]*["”`]/gu,'')
const readOnly=/(?:nur (?:lesen|prüfen|pruefen)|read[ -]only|only (?:read|check)|do not (?:write|change)|keine (?:änderungen|aenderungen)|nichts (?:ändern|aendern|speichern)|(?:nicht|never|don't|do not).{0,40}(?:übertrag|uebertrag|speicher|sync|eintragen|save|transfer|comment))/u
/** Ask only about an ambiguous requested transfer; precise create/update/comment tasks stay direct. */
export function needsAtlasTransferChoice(goal:string,previousUserGoals:string[]=[]):boolean{
 const text=clean(goal)
 if(readOnly.test(text)||/^\/(?:ba|po|pm|mock)\b/u.test(text)||/^(?:wie|how|warum|why|welche|which|was|what|wo|where|ist|is|wurde|has|erkläre|erklaere|explain)\b/u.test(text))return false
 const directive=text.replace(/^(?:bitte\s+|please\s+)?(?:(?:kannst du|könntest du|koenntest du|can you|could you)\s+)?(?:bitte\s+|please\s+)?/u,'')
 if(/^(?:erklär|erklaer|explain|zeig|show|beschreib|describe|lies|lese|read|prüf|pruef|check|analys|sag|tell|hilf|help|denk|think|überleg|ueberleg|consider)/u.test(directive))return false
 const atlas=/\batlas\b/u.test(text)||previousUserGoals.slice(-3).some(g=>/\batlas\b/u.test(clean(g)))
 if(!atlas||/(?:prüf|pruef|check).{0,60}(?:\bob\b|whether)/u.test(text))return false
 const requested=/(?:\b(?:speicher\w*|übertrag\w*|uebertrag\w*|synchronisier\w*|sync\w*|ablegen|eintragen|transfer|save|persist)\b|(?:übertrag|uebertrag)\w*|\batlas\b.{0,60}\bbring\w*\b|\btrag(?:e)?\b.{0,160}\bein\b|\b(?:bring\w*|pack\w*|stell\w*)\b.{0,120}(?:atlas|rüber|rueber|dorthin|dahin))/u.test(text)
 if(!requested)return false
 const modes=[/\b(?:kommentar\w*|kommentier\w*|comment\w*)\b/u,/\b(?:aktualisier\w*|updat\w*|ersetze\w*|replace)\b/u,/\b(?:neu(?:e[nmrs]?)? (?:atlas[- ])?(?:seite|record|ticket)|new (?:page|record|ticket)|create|erstelle|anlegen)\b/u].filter(pattern=>pattern.test(text))
 return modes.length!==1
}
const choice=/^Atlas delivery: (create|update|comment)\.\n/u
export const atlasTransferChoice=(goal:string):AtlasTransferMode|null=>(choice.exec(goal)?.[1] as AtlasTransferMode|undefined)??null
export function atlasTransferTask(goal:string,mode:AtlasTransferMode):string{
 const action={create:'Create new Atlas records.',update:'Update the existing Atlas record content.',comment:'Comment on the existing Atlas records.'}[mode]
 return `Atlas delivery: ${mode}.\n${action}\n\nOriginal human request:\n${goal}\n\nRead the exact current target records and relevant comments before effects. Resolve project, record kind and target from actual sources. Distinguish explicit human decisions from model suggestions. If a target, the confirmed content or a required decision is unclear, ask one_task_question with precise options before writing. Check existing content for duplicates; do not repeat already confirmed writes. Only use the selected delivery mode. Preserve unrelated content. Read back the result using available tools, then report each actual target link and whether the write was accepted and independently read back. If verification fails, report partial progress and the uncertainty; do not retry the write automatically.`
}
/** Host backstop: a selected mode is a narrow effect boundary, not a grant to other Atlas operations. */
export function atlasTransferEffectAllowed(mode:AtlasTransferMode,tool:string,effect:string):boolean{
 if(effect==='read')return true
 const name=tool.split(':').at(-1)
 return effect==='write'&&name===({create:'atlas_create',update:'atlas_update',comment:'atlas_comment'}[mode])
}

export function atlasTransferOriginal(goal:string):string {
 if(!atlasTransferChoice(goal))return goal
 const start=goal.indexOf('Original human request:\n'),end=goal.lastIndexOf('\n\nRead the exact current target records')
 return start>=0&&end>start?goal.slice(start+24,end):goal
}

/** A clear polite request can already name its delivery mode; do not ask the same choice again. */
export function naturalAtlasTransferMode(goal:string,previousUserGoals:string[]=[]):AtlasTransferMode|null{
 const text=clean(goal)
 if(readOnly.test(text)||/(?:prüf|pruef|check).{0,60}(?:\bob\b|whether)/u.test(text)||! /^(?:bitte|kannst du|könntest du|koenntest du|please|can you|could you)\b/u.test(text))return null
 const directive=text.replace(/^(?:bitte\s+|please\s+)?(?:(?:kannst du|könntest du|koenntest du|can you|could you)\s+)?(?:bitte\s+|please\s+)?/u,'')
 if(/^(?:erklär|erklaer|explain|zeig|show|beschreib|describe|lies|lese|read|prüf|pruef|check|analys|sag|tell|hilf|help|denk|think|überleg|ueberleg|consider)/u.test(directive))return null
 if(/(?:erklär|erklaer|explain|tell me|wissen|versteh|understand|how to|wie (?:ich|man|wir))/u.test(text))return null
 if(!/(?:speicher|trag(?:e)?\b.{0,160}\bein\b|übertrag|uebertrag|kommentier|aktualisier|ersetze|anlegen|erstelle|save|comment|update|replace|create|add)/u.test(text))return null
 if(!/\batlas\b/u.test(text)&&!previousUserGoals.slice(-3).some(g=>/\batlas\b/u.test(clean(g))))return null
 const modes:Array<[AtlasTransferMode,RegExp]>=[['comment',/\b(?:kommentier\w*|kommentar\w*|comment\w*)\b/u],['update',/\b(?:aktualisier\w*|updat\w*|ersetze\w*|replace)\b/u],['create',/\b(?:erstelle|anlegen|create|neu(?:e[nmrs]?)? (?:atlas[- ])?(?:seite|record|ticket)|new (?:atlas )?(?:page|record|ticket))\b/u]]
 const matching=modes.filter(([,pattern])=>pattern.test(text))
 return matching.length===1?matching[0]![0]:null
}
