/** Full source transport/cache bounds, never model-context budgets. */
export const MCP_SOURCE_BYTES = 8 * 1024 * 1024
export const MCP_CACHE_BYTES = 128 * 1024 * 1024
export const MCP_CACHE_ENTRIES = 2048
export const MCP_PAGE_CHARS = 12000
export const sourceBytes = (text:string) => new TextEncoder().encode(text).byteLength
