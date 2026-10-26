/** A printed control token is not a native function request. Never execute text as a tool. */
export const hasTextToolCall = (text: string) => /<\/?(?:tool_call|function)(?:\s|>|=)/i.test(text)

export const TOOL_FORMAT_REPAIR = 'Your last message printed a tool-call control token without a native function call. No tool was executed for that message. Use the provided function tools in the native tool-call format with valid arguments. For external MCP discover via one_mcp_search, then invoke the exact discovered server and name via one_mcp_call. Do not claim a search or result without its tool response. If blocked, report the blocker without control tokens. This is the only format-correction retry.'

export const WORKER_MCP_GUIDE = '\nExternal MCP functions are not directly callable. To use atlas_whoami or another external tool, first invoke one_mcp_search with the exact tool name, then one_mcp_call with the returned server, name and schema-valid arguments. Only real tool results prove access; never claim a search or execution from prose. Use native function calls, never printed tool-call tags.'
