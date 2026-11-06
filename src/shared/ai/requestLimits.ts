/** Application work budgets. Provider context windows and user cost caps are enforced separately. */
export const TERMINAL_TOOL_CALLS = 1000
export const TERMINAL_MODEL_ROUNDS = TERMINAL_TOOL_CALLS + 12
export const MCP_READ_RETRIES = 8
export const MCP_READ_WAIT_MS = 10 * 60 * 1000
export const MCP_SINGLE_WAIT_MS = 2 * 60 * 1000
