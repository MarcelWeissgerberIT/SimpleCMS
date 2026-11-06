import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { CustomAgent } from '../../store/types'
import { t } from '../../i18n'
import { scopeFilter } from './scope'
import { readInvocation, type AgentInvocationRecord } from '@/shared/agents/invocation'

/** Validate again at execution time: page and scope may have changed while the dialog was open. */
export function checkedInvocation(agent: CustomAgent, raw: unknown): AgentInvocationRecord | undefined {
  const input = readInvocation(raw)
  if (!input?.pageId) return input
  const pages = useWorkspace.getState().pages
  const page = pages[input.pageId]
  if (!page || isEffectivelyTrashed(pages, page.id) || !scopeFilter(agent)(page.id)) throw new Error(t('features.agents.invoke.outside'))
  return { ...input, pageTitle: page.title.trim() || t('common.untitled') }
}
