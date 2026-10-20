/** A bounded, model-independent contract. References are local to one confirmed plan. */
export interface DeliveryContract {
  requirements: Array<{ id: string; text: string }>
  acceptance: string[]
}
export interface DeliveryStep {
  kind: string
  criteria: string[]
  repo?: string | null
  branch?: string | null
  needs?: number[]
  covers?: string[]
}
export const DELIVERY_LIMITS = { steps: 12, codingSteps: 8, requirements: 16, acceptance: 10, text: 300 } as const

/** Preserve dependency identities when the person reorders/removes steps; a removed dependency becomes invalid. */
export function remapDependencies<T extends DeliveryStep>(before: readonly T[], after: readonly T[]): T[] {
  return after.map(s => ({ ...s, ...(s.needs ? { needs: s.needs.map(n => { const index = after.indexOf(before[n - 1]!); return index < 0 ? 0 : index + 1 }) } : {}) }))
}

/** The same bounded contract reader is used for model plans and persisted task records. */
export function readDeliveryContract(raw: unknown): { contract?: DeliveryContract; problems: string[] } {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problems: ['delivery must contain requirements and acceptance.'] }
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(k => !['requirements', 'acceptance'].includes(k))) problems.push('delivery has an unknown field.')
  const requirements: DeliveryContract['requirements'] = []
  const ids = new Set<string>()
  if (!Array.isArray(value.requirements) || !value.requirements.length || value.requirements.length > DELIVERY_LIMITS.requirements) problems.push('delivery.requirements must contain 1–16 requirements.')
  else for (const r of value.requirements) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['id', 'text'].includes(k)) || typeof r.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(r.id) || ids.has(r.id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > DELIVERY_LIMITS.text) { problems.push('delivery requirement IDs must be unique and each requirement needs bounded text.'); continue }
    ids.add(r.id); requirements.push({ id: r.id, text: r.text.trim() })
  }
  const acceptance: string[] = []
  if (!Array.isArray(value.acceptance) || !value.acceptance.length || value.acceptance.length > DELIVERY_LIMITS.acceptance) problems.push('delivery.acceptance must contain 1–10 final acceptance checks.')
  else for (const text of value.acceptance) {
    if (typeof text !== 'string' || !text.trim() || text.length > DELIVERY_LIMITS.text) problems.push('delivery acceptance checks must be bounded nonempty text.')
    else acceptance.push(text.trim())
  }
  return { ...(problems.length ? {} : { contract: { requirements, acceptance } }), problems }
}

/** Validate task dependencies and coverage against a well-formed contract. */
export function readDelivery(raw: unknown, steps: readonly DeliveryStep[]): { contract?: DeliveryContract; problems: string[] } {
  const read = readDeliveryContract(raw)
  if (!read.contract) return read
  const { requirements, acceptance } = read.contract
  const ids = new Set(requirements.map(r => r.id))
  const problems: string[] = []
  const coding = steps.flatMap((s, i) => s.kind === 'coding' ? [i + 1] : [])
  steps.forEach((s, i) => {
    if (!s.criteria.length) problems.push(`steps[${i}] needs checkable acceptance criteria.`)
    if (!Array.isArray(s.needs) || s.needs.length > DELIVERY_LIMITS.steps || new Set(s.needs).size !== s.needs.length || s.needs.some(n => !Number.isInteger(n) || n < 1 || n > i)) problems.push(`steps[${i}].needs must name unique earlier steps only.`)
    if (!Array.isArray(s.covers) || !s.covers.length || s.covers.length > DELIVERY_LIMITS.requirements || new Set(s.covers).size !== s.covers.length || s.covers.some(id => !ids.has(id))) problems.push(`steps[${i}].covers must name known requirement IDs.`)
  })
  for (const id of ids) {
    if (!steps.some(s => s.kind !== 'qa' && s.covers?.includes(id))) problems.push(`Requirement ${id} has no work step.`)
    if (coding.length && !steps.some(s => s.kind === 'coding' && s.covers?.includes(id))) problems.push(`Requirement ${id} has no coding step.`)
  }
  if (coding.length) {
    const qa = steps.at(-1)
    const work = steps.filter(s => s.kind === 'coding')
    if (work.some(s => s.branch && s.branch !== work[0]?.branch)) problems.push('Coding steps must inherit one combined branch; name an existing branch only on the first coding step, or use that same branch throughout.')
    const repos = new Set(steps.filter(s => s.kind === 'coding').map(s => s.repo).filter(Boolean))
    if (repos.size !== 1 || !qa?.repo || !repos.has(qa.repo)) problems.push('A delivery needs one known coding repository and final QA on that same repository. Split multi-repository work into separate deliveries.')
    if (qa?.kind !== 'qa' || coding.some(n => !qa.needs?.includes(n)) || [...ids].some(id => !qa.covers?.includes(id))) problems.push('A coding delivery must end with QA depending on every coding step and covering every requirement.')
  }
  return { ...(problems.length ? {} : { contract: { requirements, acceptance } }), problems }
}
