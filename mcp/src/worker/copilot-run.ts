import { COPILOT_CONTEXT_MAX, readCopilotChoice, type CopilotChoice, type CopilotReceipt, type CopilotUsage } from '../../../src/shared/copilot.ts'
import { COPILOT_CONTEXT, copilotInference, probeCopilot } from './copilot.ts'

/** A prompt-free account/model preflight, followed by one bounded harness run. No silent fallback. */
export async function prepareCopilotRun(defaultModel: string, choice: CopilotChoice | undefined, source: CopilotReceipt['source'], env: NodeJS.ProcessEnv = process.env) {
  if (choice !== undefined && !readCopilotChoice(choice)) throw new Error('Invalid Copilot task options.')
  const model = choice?.model ?? defaultModel
  const probe = await probeCopilot(env)
  if (!probe.authenticated || !probe.models.length || model !== 'auto' && !probe.models.includes(model)) throw new Error('Copilot model preflight failed. Check CLI login, model availability and organization policy. No model prompt was sent; no fallback was used.')
  const effort = choice?.reasoningEffort
  if (effort && (model === 'auto' || !('efforts' in probe) || !probe.efforts[model]?.includes(effort))) throw new Error('This Copilot model does not advertise the selected reasoning effort. Choose a supported effort or the model default. No model prompt was sent.')
  const native = 'contexts' in probe ? probe.contexts[model] : undefined
  // auto has no stable model capability: keep a conservative budget until explicitly pinned.
  const tokens = Math.min(choice?.contextTokens ?? COPILOT_CONTEXT_MAX, native ?? COPILOT_CONTEXT, COPILOT_CONTEXT_MAX)
  if(tokens<16384)throw new Error('This Copilot model advertises too little context for the coding harness. Choose another model.')
  const receipt: CopilotReceipt = { provider:'copilot', requestedModel:model, source, ...(effort ? {requestedEffort:effort} : {}), contextTokens:tokens, startedAt:Date.now(), finishedAt:Date.now(), rounds:0, usageReports:0, models:[], reasoningEfforts:[], inputTokens:null, outputTokens:null, nanoAiu:null, quotas:[] }
  const onUsage = (u: CopilotUsage) => {
    receipt.usageReports++
    if (u.model && !receipt.models.includes(u.model) && receipt.models.length < 40) receipt.models.push(u.model)
    if (u.reasoningEffort && !receipt.reasoningEfforts.includes(u.reasoningEffort) && receipt.reasoningEfforts.length < 40) receipt.reasoningEfforts.push(u.reasoningEffort)
    for (const k of ['inputTokens','outputTokens','nanoAiu'] as const) receipt[k] = u[k] === null || receipt.usageReports > 1 && receipt[k] === null ? null : (receipt[k] ?? 0) + u[k]!
    if (u.quotas.length) receipt.quotas = u.quotas
  }
  let missingUsage=false
  const adapter = copilotInference(model, env, {reasoningEffort:effort,onUsage})
  const inference: typeof adapter = async request => { receipt.rounds++;const before=receipt.usageReports;try{return await adapter(request)}finally{if(receipt.usageReports===before)missingUsage=true} }
  inference.unmetered = true
  inference.served = () => receipt.models.at(-1) ?? null
  return { model, inference, outputTokens:8192, context:{tokens,inputLimit:tokens-8192,chars:(tokens-8192)*1.5}, receipt:(): CopilotReceipt => ({...receipt,...(missingUsage?{inputTokens:null,outputTokens:null,nanoAiu:null}:{}),finishedAt:Date.now()}) }
}
