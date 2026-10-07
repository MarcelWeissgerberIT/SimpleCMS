/**
 * Media an MCP server returned (an image service, a video tool …), as One shows it: a card per item, never
 * loaded by itself. Saving is an explicit click (save.ts): the bytes are fetched then, checked and stored in
 * IndexedDB (`onefile:`), and an image / video / audio block goes where the request came from.
 */

export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaItem {
  /** stable id (a hash of the URL, or of the tool call + position for inline bytes) */
  id: string
  kind: MediaKind
  /** http(s) address of the file (absent: the bytes came inline, `data`) */
  url?: string
  /** inline bytes (base64, no data: prefix) — an image block in the tool result */
  data?: string
  /** the type the result declared (or the inline block's media type) — checked again against the bytes on save */
  mime?: string
  /** "cdn.example.com" (inline: the server's name) */
  host: string
  /** bytes, when the result said so (null: not known) */
  size: number | null
  /** the MCP server and tool that returned it */
  server: string
  tool: string
  /** what it was made from (the tool input's prompt), '' = not known — caption and alt text */
  prompt: string
  /** found in a tool result, or a link in Claude's answer on a host a result used */
  from: 'result' | 'answer'
}

/** A file saved to One: where it is and what block it becomes. */
export interface SavedMedia {
  /** "onefile:<id>" */
  src: string
  /** 'file': stored for download only (SVG can carry script — like mail attachments) */
  kind: MediaKind | 'file'
  name: string
  size: number
  mime: string
  caption: string
  alt: string
  /** the card it came from */
  itemId: string
}

/** Why saving did not work. */
export type MediaIssue =
  /** the host does not let a browser read the file (CORS) */
  | 'cors'
  | 'offline'
  /** the host answered with an error status */
  | 'http'
  /** not an image, video or audio file (the declared type) */
  | 'type'
  /** the bytes are not what the type says */
  | 'mismatch'
  | 'too_large'
  | 'empty'
  /** the inline bytes are no longer here (a reload), or the team server could not fetch it */
  | 'gone'
  | 'server'
  | 'blocked'
  | 'aborted'
