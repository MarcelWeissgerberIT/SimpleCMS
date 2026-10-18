/**
 * The task panel's MCP line: which of the person's own Claude Code MCP servers this task's stages may use (the
 * repo's "Own MCP servers for Claude Code" on the worker's setup page — or, without a repo, the worker's servers
 * for tasks without a repository). The worker names them (names only, `mcp-list`); an older worker names none and
 * the line stays away. When the task's text mentions one of One's MCP servers (its name or codeword) — or MCP at
 * all while none is given — that Claude Code may not use here, a note says so with the setup page one click away.
 * One's own MCP servers (Settings → AI) never reach Claude Code: they are for One's Claude only.
 * A chain step's own context callout (orders/stepPage.ts) names the server its text was READ from — that text is in
 * the task already, so it is no mention (B15: every chain step planned with a server carried a false note).
 */
import type { JSONContent } from '@tiptap/core'
import { plainText, useWorkspace } from '../../store/store'
import { Led } from '../../ui/controls'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { readServers } from '../ai/mcp-servers/config'
import { useCoding } from './state'
import { ChangeReposButton } from './SetupCard'
import { mentionedMcp, taskMcpServers } from './tasks'
import { stepBlockIds } from './orders/stepPage'

/** the task's text without a chain step's own context callout */
function taskText(taskId: ID, title: string, content: JSONContent | null, plain: string | undefined): string {
  const ctx = stepBlockIds(taskId).context
  const blocks = content?.content ?? []
  if (!blocks.some((b) => b?.attrs?.id === ctx)) return `${title}\n${plain ?? ''}`
  return `${title}\n${plainText({ ...content, content: blocks.filter((b) => b?.attrs?.id !== ctx) })}`
}

export function TaskMcp({ taskId, repo }: { taskId: ID; repo: string | null }) {
  const t = useT()
  const worker = useCoding((s) => s.worker)
  const connected = useCoding((s) => s.enabled && s.conn === 'connected')
  const page = useWorkspace((s) => s.pages[taskId])
  useWorkspace((s) => s.settings.mcpServers)
  if (!connected || !worker || !page) return null
  const list = taskMcpServers(worker, repo)
  if (!list) return null
  const missing = mentionedMcp(taskText(taskId, page.title, page.content, page.plain), readServers(), list)
  return (
    <div className="ctk-mcp" data-testid="coding-task-mcp">
      <span className="label">{t('features.coding.mcp.label')}</span>
      {list.length ? (
        list.map((n) => (
          <code key={n} className="ctk-mcp__name">
            {n}
          </code>
        ))
      ) : (
        <span className="ctk-mcp__none">{t('features.coding.mcp.none')}</span>
      )}
      {missing.length > 0 && (
        <p className="ctk-mcp__warn" role="note" data-testid="coding-task-mcp-missing">
          <Led state="on" />
          <span>{t(repo ? 'features.coding.mcp.missing' : 'features.coding.mcp.missingNoRepo', { names: missing.join(', ') })}</span>
          <ChangeReposButton className="btn btn--sm" label={t('features.coding.mcp.fix')} testId="coding-task-mcp-fix" />
        </p>
      )}
    </div>
  )
}
