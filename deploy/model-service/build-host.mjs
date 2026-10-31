import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(new URL('../../mcp/package.json',import.meta.url)),{build}=require('esbuild')
if(!process.argv[2])throw new Error('Supply an output file path outside the repository')
await build({entryPoints:[fileURLToPath(new URL('./one-host.ts',import.meta.url))],outfile:process.argv[2],bundle:true,platform:'node',preserveSymlinks:true,format:'esm',target:'node24',logLevel:'warning',legalComments:'eof',external:['bufferutil','utf-8-validate'],banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}})
