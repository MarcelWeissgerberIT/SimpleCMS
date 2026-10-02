// STUB — replaced by the features area.
import { useWorkspace } from '../../store/store'

export type AIAction = 'continue' | 'improve' | 'shorter' | 'longer' | 'fix' | 'summarize' | 'translate' | 'explain' | 'action_items' | 'custom' | 'autofill'

export interface RunAIOptions {
  action: AIAction
  /** Selected text or block text the action applies to */
  input: string
  /** Free-form instruction for 'custom' / target language for 'translate' */
  instruction?: string
  /** Surrounding page context (title + plain text) */
  context?: string
  onToken?: (text: string) => void
  signal?: AbortSignal
}

export function isAIConfigured(): boolean {
  return !!useWorkspace.getState().settings.aiApiKey
}

export async function runAI(_opts: RunAIOptions): Promise<string> {
  throw new Error('AI not implemented yet')
}
