/**
 * One MCP — the shared tables (pure data, no imports): the local bridge (mcp/, through src/shared/mcp/contract.ts), the
 * One tab (src/app/features/mcp) and the team server (server/src/mcp) read the same lists, so the two implementations
 * of the tool set cannot drift (server/test/mcp-parity.test.ts, tests/e2e/mcp-contract.spec.ts).
 */

/** Property types an agent can create (formula and rollup need the app's editors). */
export const MCP_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'files',
  'relation',
  'rating',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id',
] as const

/** Filter operators of one_query_database and of view filters (the aliases after the canonical ones). */
export const MCP_FILTER_OPS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'starts_with',
  'ends_with',
  'is_checked',
  'is_not_checked',
  // aliases
  'eq',
  'neq',
  'is',
  'is_not',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
] as const

/** View layouts an agent can create or switch to (chart and form views need the app's editors). */
export const MCP_VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed'] as const

/**
 * Property type changes an agent may make — the ones whose values carry over without loss (option names, text).
 * Everything else is refused with this list; the person changes it in One.
 */
export const MCP_TYPE_CHANGES: Record<string, readonly string[]> = {
  text: ['url', 'email', 'phone', 'select', 'multi_select'],
  url: ['text', 'email', 'phone'],
  email: ['text', 'url', 'phone'],
  phone: ['text', 'url', 'email'],
  select: ['multi_select', 'status', 'text'],
  status: ['select', 'multi_select', 'text'],
  multi_select: ['text'],
  number: ['text'],
}

/** Most items one call trashes or restores. */
export const MCP_BULK_MAX = 50

/** Rows one one_run_query answer carries (the count says how many matched). */
export const MCP_QUERY_ROWS = 100

const KB = 1024
const MB = 1024 * KB

/** Every size the tools keep to (spec § 3.4) — one table for the bridge, the tab and the team server. */
export const MCP_LIMITS = {
  /** one result part, measured on its serialized (compact JSON) text */
  part: 40_000,
  /** blocks in one part of a page read */
  partBlocks: 400,
  /** list tools: default and most items per answer */
  listDefault: 50,
  listMax: 200,
  /** one_create_page `pages`: entries and Markdown in all */
  pages: 50,
  pagesChars: 600_000,
  /** rows per create / update / upsert call */
  rows: 50,
  /** a row batch of at least this many rows that starts paid AI work or outward automations is always asked */
  rowsAsk: 5,
  /** one_edit_blocks: edits and their text per call */
  edits: 30,
  editsChars: 200_000,
  /** block specs per call */
  blockSpecs: 200,
  /** spreadsheet writes */
  sheets: 5,
  sheetCells: 10_000,
  /** chart data points */
  chartPoints: 500,
  /** file text extraction: characters in all, wall clock */
  extractChars: 400_000,
  extractMs: 10_000,
  /** image reads: edge, bytes, decode size (megapixels × 10⁶) */
  imagePx: 1568,
  imageBytes: 5 * MB,
  imageDecodePx: 50_000_000,
  /** a PDF as a resource (the B1 spike decides — moved to T-b / B5; at most this) */
  pdfBytes: 10 * MB,
  /** a base64 upload from the model */
  base64Bytes: 256 * KB,
  /** web files fetched for an attach */
  urlImage: 50 * MB,
  urlMedia: 200 * MB,
  urlPdf: 25 * MB,
  /** one_download_file: per file, per bridge process and day */
  downloadFile: 200 * MB,
  downloadDay: 1024 * MB,
  /** attach quotas per day: bridge process · server token · server workspace */
  attachBridgeDay: 500 * MB,
  attachTokenDay: 100 * MB,
  attachWorkspaceDay: 500 * MB,
  /** team server request bodies: read tokens · write tokens */
  bodyRead: 256 * KB,
  bodyWrite: 512 * KB,
  /** `$content` entries per result (images, PDF resources) */
  content: 4,
  /** duplicate calls: the window and the entries kept per MCP session */
  duplicateMs: 120_000,
  duplicateEntries: 50,
  /** team server pre-images of MCP writes, days */
  preimageDays: 14,
  /** bridge ⇄ tab WebSocket frames and their chunks */
  frame: 16 * MB,
  chunk: 4 * MB,
  /** properties of one_create_database */
  properties: 40,
  /** the model-facing budget: tools/list (serialized) and the instructions */
  toolsList: 55_000,
  instructions: 3_500,
} as const

/** The block specs of § 2.6 (non-Markdown input; B4 builds them). */
export const MCP_BLOCK_SPECS = ['markdown', 'callout', 'columns', 'database', 'image', 'video', 'audio', 'file', 'bookmark', 'toc', 'chart', 'spreadsheet'] as const

/** File kinds of one_list_files (B5). */
export const MCP_FILE_KINDS = ['image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'other'] as const

/**
 * File extensions MCP never saves to disk nor attaches, whatever the source (B5 / B6): programs, scripts, installers,
 * shortcuts and macro-enabled Office files. Lower case, no dot.
 */
export const MCP_REFUSED_EXT = [
  // programs and installers
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msix', 'appx', 'app', 'dmg', 'pkg', 'mpkg', 'deb', 'rpm', 'apk', 'jar', 'iso', 'img', 'dll', 'so', 'dylib', 'bin', 'run',
  // scripts
  'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'mjs', 'cjs', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'bash', 'zsh', 'command', 'tool', 'scpt', 'applescript', 'workflow', 'py', 'pyw', 'rb', 'pl', 'php', 'reg',
  // shortcuts
  'lnk', 'url', 'webloc', 'desktop', 'inetloc', 'scf',
  // macro-enabled Office
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
] as const

/**
 * The node and mark names the team server's Markdown writes (server/src/api/content.ts markdownToNodes): a replace over
 * the team server may only replace a page made of these — anything else would be lost without a card or an Undo. The
 * lossy pre-filter until the server's own round trip (B4s).
 */
export const MCP_PLAIN_NODES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak'] as const
export const MCP_PLAIN_MARKS = ['bold', 'italic', 'strike', 'code', 'link'] as const

/** Tools only the local bridge (the One tab) serves; the team server lists the rest. */
export const MCP_LOCAL_ONLY: readonly string[] = ['one_run_query', 'one_run_script', 'one_list_work_items', 'one_update_work_item', 'one_download_file']

/**
 * Arguments the team server declares like the bridge but answers `local_only` for (private pages, templates, picked or
 * local files, chart / spreadsheet specs). B3: `private`; B6 adds `source.pick` / `source.path`, B7 `template`.
 */
export const MCP_LOCAL_ONLY_ARGS: Readonly<Record<string, readonly string[]>> = { one_create_page: ['private'] }

/**
 * Tools whose calls make something new: a repeat with the same arguments joins the call that is still waiting, or
 * answers the result of the one applied in the last 2 minutes (`duplicateOf`) — never a second copy.
 */
export const MCP_CREATING_TOOLS: readonly string[] = ['one_create_page', 'one_create_database', 'one_create_row', 'one_upsert_rows', 'one_attach_file', 'one_comment']

/**
 * The tool contract's revision: 1 = what One tabs before it (bridge 1.11.0) answered; 2 = train T-a (hello `tools`,
 * strict arguments, duplicate joining). A tab says its revision in its hello.
 */
export const MCP_CONTRACT_REV = 2

/**
 * The arguments every tool took in contract 1 (One before T-a), frozen — never edited: a tab that announces no `tools`
 * in its hello is judged against this, so a newer argument sent to an older tab is refused (`app_outdated`) instead of
 * being dropped silently (`one_create_page { private: true }` would otherwise make a shared page). `workspace` is the
 * bridge's own argument and never forwarded.
 */
export const MCP_ARGS_V1: Readonly<Record<string, readonly string[]>> = Object.freeze({
  one_overview: [],
  one_list_workspaces: [],
  one_search: ['query', 'limit'],
  one_get_page: ['id', 'title'],
  one_list_databases: [],
  one_get_database: ['id'],
  one_query_database: ['databaseId', 'filter', 'sort', 'limit', 'cursor'],
  one_create_page: ['title', 'parentId', 'markdown', 'icon'],
  one_update_page: ['id', 'title', 'icon', 'markdown', 'mode'],
  one_create_row: ['databaseId', 'title', 'properties', 'markdown'],
  one_update_row: ['id', 'properties'],
  one_create_property: ['databaseId', 'name', 'type', 'options', 'relation'],
  one_update_property: ['databaseId', 'property', 'name', 'description', 'type', 'options'],
  one_delete_property: ['databaseId', 'property'],
  one_create_database: ['title', 'parentId', 'properties'],
  one_update_database: ['id', 'title', 'icon', 'locked'],
  one_create_view: ['databaseId', 'type', 'name', 'groupBy', 'dateProperty', 'filter', 'sort', 'properties'],
  one_update_view: ['databaseId', 'view', 'type', 'name', 'groupBy', 'dateProperty', 'filter', 'sort', 'properties'],
  one_delete_view: ['databaseId', 'view'],
  one_move_page: ['id', 'parentId', 'before', 'after', 'index'],
  one_move_row: ['id', 'databaseId'],
  one_trash_page: ['id', 'ids'],
  one_restore_page: ['id', 'ids'],
  one_run_query: ['code', 'limit'],
  one_run_script: ['script', 'pageId', 'dryRun'],
  one_list_work_items: ['status', 'person', 'pageId', 'blocked', 'overdue', 'dueBefore', 'query', 'limit'],
  one_update_work_item: ['updates'],
})

/**
 * The bridge version that brings what this contract needs (strict arguments, duplicate joining, compact results). An
 * older bridge still works; #/mcp and Settings → Agents · MCP ask for an update. ≤ mcp/package.json's version.
 */
export const MCP_BRIDGE_CURRENT = '1.12.0'
