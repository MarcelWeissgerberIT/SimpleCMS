/**
 * One MCP — state of this tab's bridge connection (useMcp) and this device's settings.
 * Settings live in localStorage ('one.mcp'): per browser, never part of the workspace, never
 * synced to a team. The activity log is this tab's session only.
 */
import { create } from 'zustand'
import { MCP_DEFAULT_PORT, type McpAgentMode, type McpClientInfo, type McpPeer, type McpToolName } from './contract'
import type { WritePlan } from './write'

export const MCP_STORAGE_KEY = 'one.mcp'

export interface McpSettings {
  /** "Allow AI agents on this computer" */
  enabled: boolean
  /** Agent changes: ask first (default) · apply directly · read only */
  mode: McpAgentMode
  port: number
}

export const DEFAULT_SETTINGS: McpSettings = { enabled: false, mode: 'ask', port: MCP_DEFAULT_PORT }

export function loadSettings(): McpSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MCP_STORAGE_KEY) ?? 'null') as Partial<McpSettings> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    return {
      enabled: raw.enabled === true,
      mode: raw.mode === 'apply' || raw.mode === 'read' ? raw.mode : 'ask',
      port: validPort(raw.port) ?? MCP_DEFAULT_PORT,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: McpSettings): void {
  try {
    window.localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* private mode: this tab keeps it in memory */
  }
}

export const validPort = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null
}

/**
 * off · connecting (first try) · waiting (no bridge yet, retrying) · connected · replaced (a newer
 * tab took over: no automatic retry) · blocked (the browser refuses the connection)
 */
export type McpConn = 'off' | 'connecting' | 'waiting' | 'connected' | 'replaced' | 'blocked'

/** Why the browser blocks: an https page may not open ws:// (Safari) · the local-network permission was denied (Chrome). */
export type McpBlock = 'insecure' | 'permission'

export type ActivityState = 'run' | 'wait' | 'ok' | 'same' | 'err' | 'rejected' | 'timeout' | 'cancelled' | 'undone'

export interface McpActivity {
  id: string
  at: number
  tool: McpToolName
  write: boolean
  target: string
  state: ActivityState
  ms?: number
  /** error message (as the agent got it) */
  note?: string
  /** revert an applied write (this tab session) */
  undo?: () => boolean
}

/** … 'workspace': the tab switched to another workspace while the change waited */
export type Verdict = 'approve' | 'reject' | 'timeout' | 'cancel' | 'mode' | 'gone' | 'workspace'

export interface McpApproval {
  /** the bridge's call id */
  id: string
  plan: WritePlan
  /** the workspace the change is for (the card names it; switching away cancels the change) */
  workspace: { id: string; name: string }
  at: number
  expiresAt: number
}

export interface McpState extends McpSettings {
  conn: McpConn
  blocked: McpBlock | null
  /** the browser will ask (Chrome: "apps on this device") */
  prompt: boolean
  client: McpClientInfo | null
  bridge: string | null
  /** the bridge speaks only the first protocol (one tab, calls not bound to a workspace): update it */
  legacy: boolean
  /** other workspaces connected to the same bridge right now (other tabs) */
  peers: McpPeer[]
  /** tool calls since this connection started */
  calls: number
  /** a call is being answered right now */
  busy: number
  activity: McpActivity[]
  approvals: McpApproval[]
}

export const useMcp = create<McpState>()(() => ({
  ...loadSettings(),
  conn: 'off',
  blocked: null,
  prompt: false,
  client: null,
  bridge: null,
  legacy: false,
  peers: [],
  calls: 0,
  busy: 0,
  activity: [],
  approvals: [],
}))

/** "claude-ai" → "Claude Desktop" … (the clientInfo names MCP clients send). */
export function clientLabel(c: McpClientInfo | null): string | null {
  if (!c?.name) return null
  const n = c.name.toLowerCase()
  if (n === 'claude-ai' || n === 'claude desktop' || n === 'claude-desktop') return 'Claude Desktop'
  if (n === 'claude-code' || n === 'claude code') return 'Claude Code'
  if (n.startsWith('cursor')) return 'Cursor'
  if (n.includes('visual studio code') || n === 'vscode') return 'VS Code'
  if (n.includes('windsurf')) return 'Windsurf'
  if (n.includes('zed')) return 'Zed'
  // something else: its own name, printable and short
  return c.name.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 32) || null
}
