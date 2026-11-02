/** Public metadata only. Provider credentials never cross this contract. */
export const CENTRAL_CLAUDE_MODEL = 'claude-opus-5-5'
export interface CentralAIStatus {
  assigned: boolean
  id?: string
  version?: number
  label?: string
  model?: string
  enabled?: boolean
  configured?: boolean
  verifiedAt?: number | null
  ready?: boolean
  manage?: boolean
  month?: string
  budgetUsd?: number | null
  spentUsd?: number
  heldUsd?: number
  workspaces?: {id:string;name:string}[]
}
export interface CentralAIRequest {
  id:string; workspace:string; createdAt:number; finishedAt:number|null
  state:string; usd:number; reservedUsd:number; inputTokens:number|null; outputTokens:number|null
}
