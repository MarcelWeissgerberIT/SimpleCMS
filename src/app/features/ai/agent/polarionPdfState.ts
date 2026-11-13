import type {AgentStep} from './types'

/** Check actual file nodes, never prose containing a filename or an old applied change. */
export function hasPdfAttachment(content: unknown, src: string): boolean {
  if (!content || typeof content !== 'object') return false
  const node = content as {type?:string;attrs?:{src?:string};content?:unknown[]}
  return (node.type === 'fileBlock' && node.attrs?.src === src) ||
    (Array.isArray(node.content) && node.content.some(child => hasPdfAttachment(child, src)))
}

/** Polls for one job are one export. Preserve the import receipt across later polls. */
export function pdfExportSteps(steps: AgentStep[]): AgentStep[] {
  const jobs = new Map<string, AgentStep>()
  for (const step of steps) {
    const receipt = step.mcp?.receipt
    if (step.state !== 'ok' || !receipt?.polarionPdf || !receipt.server) continue
    const key = receipt.server + ':' + receipt.polarionPdf.job, previous = jobs.get(key)
    jobs.set(key, previous?.mcp?.pdfImported ? previous : step)
  }
  return [...jobs.values()]
}

export function hasPdfExportWork(steps: AgentStep[]): boolean {
  return steps.some(step => !!step.mcp?.receipt?.polarionPdf || step.mcp?.tool === 'atlas_polarion_export_pdf')
}
