/**
 * The Claude Desktop extension: an MCP Bundle (public/mcp/one.mcpb) — a ZIP with manifest.json,
 * the bridge bundle (server/one-mcp.mjs, the very file the site serves), icon.png and README.md.
 * Opening it in Claude Desktop installs the bridge with one click: no terminal, no config file,
 * no Node.js (Claude Desktop runs "node" extensions with the Node.js it ships).
 *
 * Manifest format: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md (spec 0.3,
 * checked against the published JSON schema in mcp/mcpb/ and `mcpb validate` of @anthropic-ai/mcpb).
 * Built by build.mjs (npm run build:mcp); tested by test/mcpb.test.ts.
 */
import { MCP_DEFAULT_PORT, MCP_TOOLS, type McpToolName } from '../../src/app/features/mcp/contract.ts'
import { zip } from './zip.ts'

export const MCPB_MANIFEST_VERSION = '0.3'
/** Where the bridge lives inside the bundle. */
export const MCPB_ENTRY = 'server/one-mcp.mjs'

const REPO = 'https://github.com/MarcelWeissgerberIT/SimpleCMS'

/**
 * One line per tool for Claude Desktop's extension page (people read these; the model gets the
 * full descriptions from tools/list). Keyed by tool name, so a new tool fails the typecheck here.
 */
const TOOL_SUMMARIES: Record<McpToolName, string> = {
  one_overview: 'Workspace name, today, the page tree, every database and the people.',
  one_list_workspaces: 'The workspaces connected right now (one per tab): id, name, access.',
  one_search: 'Search titles, text and row values.',
  one_get_page: 'Read a page or row: properties, content as Markdown, sub-pages, backlinks.',
  one_list_databases: 'Every database with its properties and row count.',
  one_get_database: 'The schema of a database: property types, options, views.',
  one_query_database: 'Rows of a database, filtered, sorted and paginated.',
  one_create_page: 'Create a page from Markdown.',
  one_update_page: 'Change the title, icon or content of a page or row.',
  one_create_row: 'Add a row to a database.',
  one_update_row: 'Set property values of a row.',
  one_create_property: 'Add a property (column) to a database.',
  one_update_property: 'Rename a property, change its options or (safely) its type.',
  one_delete_property: 'Delete a property and its values.',
  one_create_database: 'Create a database with a table view.',
  one_update_database: 'Rename a database or change its icon.',
  one_create_view: 'Add a view: table, board, list, gallery, calendar, timeline, feed.',
  one_update_view: 'Change a view: layout, grouping, filter, sorts, visible properties.',
  one_delete_view: 'Remove a view (the rows stay).',
  one_move_page: 'Move a page or database to another place in the tree.',
  one_move_row: 'Move a row into another database whose properties fit.',
  one_trash_page: 'Move pages, rows or databases (with their rows) to the trash — one or many, restorable.',
  one_restore_page: 'Bring pages, rows or databases back from the trash.',
}

const LONG_DESCRIPTION = `Claude searches, reads and writes your [One](https://getonecms.com/) workspace — pages, databases, rows and properties — in the One tab you have open in your browser.

**After installing:** open One and switch on *Settings → Agents · MCP → Allow AI agents on this computer*. The panel's LED turns green. Then ask Claude *"What is in my One workspace?"* — or start a message with the codeword \`one:\`, e.g. *"one: tidy up my Projects database"*.

- **Nothing leaves your computer.** The extension listens on 127.0.0.1 only and accepts One's own pages; your workspace stays in the browser.
- **Tidy up, safely.** Move pages and rows, reshape databases (properties, options, views), trash whole databases with their rows — nothing is deleted for good, everything can be restored.
- **You stay in charge.** Each change waits for your approval in One (*Ask first*, the default) — or set *Apply directly* or *Read only* there. Every call is logged and can be undone.
- **Workspaces stay apart.** Several workspaces can be connected at once (each in its tab); Claude names the one it means, and a call meant for one workspace never runs in another.
- **Same tools everywhere:** the team server of One offers the same tools at \`/mcp\`.

Guide and security model: ${REPO}/blob/main/docs/MCP.md`

export interface McpbManifest {
  manifest_version: string
  name: string
  display_name: string
  version: string
  description: string
  long_description: string
  author: { name: string; url: string }
  repository: { type: string; url: string }
  homepage: string
  documentation: string
  support: string
  icon: string
  server: {
    type: 'node'
    entry_point: string
    mcp_config: { command: string; args: string[]; env: Record<string, string> }
  }
  tools: { name: string; description: string }[]
  keywords: string[]
  license: string
  compatibility: { platforms: ('darwin' | 'win32' | 'linux')[]; runtimes: { node: string } }
  user_config: Record<string, { type: 'string' | 'number'; title: string; description: string; required: boolean; default: string | number; min?: number; max?: number }>
}

export function mcpbManifest(version: string): McpbManifest {
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: 'one-mcp',
    display_name: 'SimpleCMS One',
    version,
    description: 'Let Claude search, read and write your One workspace — pages, databases and rows — in the One tab open in your browser.',
    long_description: LONG_DESCRIPTION,
    author: { name: 'Marcel Weissgerber', url: REPO },
    repository: { type: 'git', url: `${REPO}.git` },
    homepage: 'https://getonecms.com/',
    documentation: `${REPO}/blob/main/docs/MCP.md`,
    support: `${REPO}/issues`,
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: MCPB_ENTRY,
      mcp_config: {
        command: 'node',
        args: [`\${__dirname}/${MCPB_ENTRY}`],
        // both have defaults, so Claude Desktop always substitutes them (the bridge also ignores a
        // placeholder left as it is)
        env: { ONE_MCP_PORT: '${user_config.port}', ONE_ORIGINS: '${user_config.origins}' },
      },
    },
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: TOOL_SUMMARIES[t.name] })),
    keywords: ['notion', 'notes', 'workspace', 'pages', 'databases', 'knowledge base', 'local-first'],
    license: 'MIT',
    // the bundle targets Node 20 (esbuild target node20)
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=20.0.0' } },
    user_config: {
      port: {
        type: 'number',
        title: 'Port',
        description: `Port the One tab connects to (default ${MCP_DEFAULT_PORT}). Change it only together with the port in One → Settings → Agents · MCP.`,
        required: false,
        default: MCP_DEFAULT_PORT,
        min: 1024,
        max: 65535,
      },
      origins: {
        type: 'string',
        title: 'Extra allowed origins',
        description:
          'Only for One served from your own domain: its origin, e.g. https://one.example.com (several: comma-separated). getonecms.com and localhost are always allowed.',
        required: false,
        default: '',
      },
    },
  }
}

export interface McpbFiles {
  version: string
  /** the built bridge (public/mcp/one-mcp.mjs) */
  server: Uint8Array
  /** 512×512 PNG */
  icon: Uint8Array
  /** README.md; {{version}} is replaced */
  readme: string
}

/** The .mcpb file: deterministic (same inputs → same bytes). */
export function packMcpb(f: McpbFiles): Buffer {
  const manifest = `${JSON.stringify(mcpbManifest(f.version), null, 2)}\n`
  return zip([
    { name: 'manifest.json', data: Buffer.from(manifest, 'utf8') },
    { name: 'README.md', data: Buffer.from(f.readme.replaceAll('{{version}}', f.version), 'utf8') },
    { name: 'icon.png', data: f.icon },
    { name: MCPB_ENTRY, data: f.server, mode: 0o755 },
  ])
}
