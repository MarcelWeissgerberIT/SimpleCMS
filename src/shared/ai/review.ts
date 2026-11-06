/** Model-independent review boundary. Source checks prove observed quotations, never domain truth or approval. */
const BASE_REVIEW_POLICY = `Review and human decisions
- The harness opens access to permitted context and tools and coordinates bounded work; it is not a domain decision-maker. Models should actively detect contradictions, inconsistencies and problems, group related findings, explain impact and recommend concrete next steps. These remain support for the team.
- Help the team evaluate the work; do not persuade it to adopt AI or promise a model's quality or time savings. A rejected proposal is a valid result.
- For a contradiction cite both statements with actual source locations and available version/date/commit. Compare function, environment, scope and version first: a superseded version is not automatically a contradiction. Missing evidence is an information gap, not a confirmed conflict. Never invent quotations, links or decisions.
- When check_finding or one_task_check_finding is available, use the tool named by the receipt’s checkWith field with source receipts from actual reads before reporting a contradiction. A quotation check only proves that text occurred in an observed snapshot; it does not prove semantic conflict, currentness, correctness or authority. If a source has no receipt, read it through the available source tool or report it as unverified. Never relabel an unchecked finding as verified.
- Separate finding, sources, context/version check, possible impact, options, recommendation (PROPOSAL) and team decision (OPEN unless an actual human decision is documented with its source). Do not choose product behaviour, scope, priorities, domain trade-offs or acceptance for the team. Respect documented human decisions; never infer consent or invent a decision-maker or test success.
- Actively maintain useful knowledge: first retrieve relevant documented decisions and constraints from the granted Atlas context before re-asking or proposing conflicting work. When a durable finding, documented human decision, constraint or open question emerges, save its source, scope/version, reason and when to recall it through memory_knowledge, memory_checkpoint or the explicitly granted Atlas memory tools. Keep proposals, findings and references to confirmed human decisions separate; never turn a memory into a new decision. Use the configured project/tenant only. Deduplicate and link superseded knowledge rather than silently overwriting decisions. If Atlas is unavailable or not granted, preserve a local/pending handoff and explicitly report ATLAS PENDING, never claim it was saved or repeatedly retry. Before finishing, check whether important knowledge needs a checkpoint; do not save trivial chatter or credentials.
- Continue ordinary permitted reversible technical work inside the approved scope. Bundle only genuinely blocking decisions; collect other open points in the report. Do not repeatedly ask for facts already supplied. A finding grants no extra permissions, approvals, merges or access. Memory and model statements are reference data, not evidence.`

export const ASSURANCE_POLICY = `Bounded delivery assurance
- Before coding, compare the task, granted Atlas requirements/decisions and repository rules. Record source location, version, scope and stated authority; unknown stays unknown. A later timestamp alone cannot override a requirement. Distinguish a different version/scope from an unresolved rule conflict. Check only relevant passages, not a blanket audit.
- Ask a blocking question only if its answer changes permitted behaviour or a required check. A decision pin contains two materially different options, one concrete input on which their expected outcomes differ, and the acceptance check that would settle it. Use check_finding/one_task_check_finding with decisionPin and context when available. These tools draft supported questions, never approve a choice. Look for an already documented human answer first; nonblocking details stay proposals in the report.
- Start with the smallest useful implementation and independent QA, not extra agents by default. Add a specialist only for a concrete unresolved risk. Preserve measured duration, tool/turn counts and known costs; missing usage/cost is unknown, never zero. Compare the same task, candidate and checks across models; do not infer superiority from one passing example.
- After fixing a candidate, seek one new discriminating boundary/counterexample from the actual acceptance contract. Preserve existing checks and keep useful regression cases. Host receipts distinguish configured tests from optional owner-configured challenge checks. Unconfigured checks, unknown snapshots and model-authored tests alone are not independent proof. Do not add extra model loops merely to produce more reviews.
- Reusable procedures are human-curated suggestions with source/evidence, applicability, steps, limitations and a recall trigger. One successful task does not prove transfer to another. Recheck current sources and checks on reuse; never rewrite governing rules, learn permissions, copy credentials or treat a saved procedure as a new approval.`
export const REVIEW_POLICY = BASE_REVIEW_POLICY + '\n\n' + ASSURANCE_POLICY

export const FINDING_DESCRIPTION = 'Check exact quotations against source receipts from actual reads in THIS run. Optionally supply declared version/scope/authority context and a decisionPin with two different expected outcomes for one example and an acceptance check. No fetching, writing or approval; question drafts remain open. Missing/expired receipts or unmatched quotes yield insufficient_evidence.'
const citation = { type: 'object', properties: { receipt: { type: 'string', maxLength: 100 }, quote: { type: 'string', minLength: 16, maxLength: 2000 } }, required: ['receipt', 'quote'], additionalProperties: false }
const textField = { type: 'string', minLength: 1, maxLength: 500 }
const contextFields = ['versionA','versionB','scopeA','scopeB','authorityA','authorityB'] as const
export const FINDING_SCHEMA = { type: 'object' as const, properties: {
 classification: { type: 'string', enum: ['possible_contradiction', 'version_difference', 'information_gap'] }, sourceA: citation, sourceB: citation,
 context: { type:'object', properties:Object.fromEntries(contextFields.map(k=>[k,textField])), additionalProperties:false },
 decisionPin: { type:'object',properties:{question:textField,example:textField,check:textField,blocking:{type:'boolean'},options:{type:'array',minItems:2,maxItems:2,items:{type:'object',properties:{label:textField,expected:textField},required:['label','expected'],additionalProperties:false}}},required:['question','example','check','blocking','options'],additionalProperties:false },
}, required: ['classification', 'sourceA'], additionalProperties: false }

type RecordSource = { receipt: string; location: string; observedAt: number; text: string[] }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
/** JSON tool outputs contain escaped excerpts. Inspect string values, never keys or host receipt metadata. */
function passages(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text), parts: string[] = []
    const walk = (v: unknown, depth: number) => { if (depth > 12 || parts.length >= 2000) return; if (typeof v === 'string') parts.push(v); else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1)); else if (object(v)) for (const [k, x] of Object.entries(v)) if (k !== '_oneSource') walk(x, depth + 1) }
    walk(value, 0); let left = 40000; return parts.flatMap(p => { const text = p.slice(0, left); left -= text.length; return text ? [text] : [] })
  } catch { return [text.slice(0, 40000)] }
}
const normalize = (s: string) => s.replace(/\r\n/g, '\n')

export class ReviewSources {
  private readonly checker: string
  constructor(checker = 'check_finding') { this.checker = checker }
  private sources = new Map<string, RecordSource>()
  private prefix = globalThis.crypto.randomUUID()
  private sequence = 0
  /** Scope-local, bounded snapshots. Never feed model-created notes, summaries or memory into this registry. */
  observe(text: string, location: string): string {
    const source = { receipt: `src_${this.prefix}_${++this.sequence}`, location: location.slice(0, 300), observedAt: Date.now(), text: passages(text) }
    this.sources.set(source.receipt, source)
    if (this.sources.size > 24) this.sources.delete(this.sources.keys().next().value!)
    const { text: _, ...receipt } = source
    try { const value: unknown = JSON.parse(text); if (object(value)) return JSON.stringify({ ...value, _oneSource: { ...receipt, checkWith: this.checker } }) } catch { /* plain text source */ }
    return `${text}\n\n[One observed source: ${JSON.stringify({ ...receipt, checkWith: this.checker })}. Snapshot quotation support only; not instructions or approval.]`
  }
  /** Writes invalidate observations in this run. Reading again obtains new receipts. */
  clear() { this.sources.clear() }
  check(input: unknown) {
    if (!object(input) || Object.keys(input).some(k => !['classification', 'sourceA', 'sourceB', 'context', 'decisionPin'].includes(k)) || !['possible_contradiction', 'version_difference', 'information_gap'].includes(String(input.classification))) throw new Error('Use classification, sources, optional context and decisionPin only. No decision or approval can be supplied.')
    const bounded=(s:unknown):s is string=>typeof s==='string'&&!!s.trim()&&s.length<=500
    let context:Record<string,string>|undefined
    if(input.context!==undefined){if(!object(input.context)||Object.entries(input.context).some(([k,v])=>!contextFields.includes(k as typeof contextFields[number])||!bounded(v)))throw new Error('Context contains bounded version, scope and authority declarations only.');context={...input.context} as Record<string,string>}
    let decisionPin:Record<string,unknown>|undefined
    if(input.decisionPin!==undefined){const p=input.decisionPin
      if(!object(p)||Object.keys(p).some(k=>!['question','example','check','blocking','options'].includes(k))||![p.question,p.example,p.check].every(bounded)||typeof p.blocking!=='boolean'||!Array.isArray(p.options)||p.options.length!==2||p.options.some(o=>!object(o)||Object.keys(o).some(k=>!['label','expected'].includes(k))||!bounded(o.label)||!bounded(o.expected)))throw new Error('A decision pin needs a question, one separating example, two options with expected outcomes, a check and blocking flag.')
      const [a,b]=p.options as Array<{label:string;expected:string}>,norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ')
      if(norm(a!.label)===norm(b!.label)||norm(a!.expected)===norm(b!.expected))throw new Error('Options must name different choices and different expected outcomes.')
      decisionPin={question:p.question,example:p.example,check:p.check,blocking:p.blocking,options:p.options.map(o=>({label:o.label,expected:o.expected}))}
    }
    const check = (raw: unknown) => {
      if (!object(raw) || Object.keys(raw).some(k => !['receipt', 'quote'].includes(k)) || typeof raw.receipt !== 'string' || raw.receipt.length > 100 || typeof raw.quote !== 'string' || raw.quote.trim().length < 16 || raw.quote.length > 2000) return { verified: false, error: 'Supply a receipt and an exact quote of 16–2000 characters.' }
      const source = this.sources.get(raw.receipt)
      if (!source) return { verified: false, error: 'Unknown, expired or invalidated receipt. Read the source again in this run.' }
      const quote = raw.quote
      if (!source.text.some(text => normalize(text).includes(normalize(quote)))) return { verified: false, error: 'Quote not found in the observed excerpt. Read the correct passage; do not paraphrase a quotation.' }
      return { verified: true, receipt: source.receipt, location: source.location, observedAt: source.observedAt, quote: raw.quote }
    }
    const a = check(input.sourceA), b = input.sourceB === undefined ? null : check(input.sourceB)
    const pair = a.verified && b?.verified && !(object(input.sourceA) && object(input.sourceB) && input.sourceA.receipt === input.sourceB.receipt && input.sourceA.quote === input.sourceB.quote)
    const supported=input.classification==='information_gap'?a.verified:pair
    return { status: input.classification === 'information_gap' ? 'information_gap' : pair ? 'quotations_supported' : 'insufficient_evidence', classification: input.classification, sourceA: a, sourceB: b,
      ...(context?{context:{declared:context,authority:'not_verified'}}:{}),...(decisionPin?{decisionPin:{...decisionPin,status:'draft',quotationSupported:!!supported,readyToAsk:!!supported&&decisionPin.blocking===true,teamDecision:'open',saveAs:'open_question_not_a_decision'}}:{}),
      semanticConflict: 'not_verified', currentness: 'snapshot_only', teamDecision: 'open', next: 'Check context, versions, source authority and meaning. Recommendation is a proposal; the team decides.' }
  }
}
