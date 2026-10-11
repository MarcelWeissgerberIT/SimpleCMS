/**
 * The tape's size and age for the status cell, the deck's REC chip and the Data line: read from the scope's
 * bookkeeping (never the records), first a moment after boot (the journal is never opened during boot), then again
 * after writes (debounced) and after a wipe or a prune.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { onJournalChange } from '../journal/bus'
import { tapeInfo, type TapeInfo } from '../journal/query'
import { scopeNow } from '../journal/scope'
import { journalIfOpen } from '../journal/db'
import { recorder } from '../journal/recorder'
import type { Scope } from '../model/types'

const DAY = 24 * 3600_000
const FIRST_READ_MS = 1500
const REREAD_MS = 2000

interface InfoState {
  scope: Scope | null
  info: TapeInfo | null
}

export const useTapeInfo = create<InfoState>()(() => ({ scope: null, info: null }))

let timer: ReturnType<typeof setTimeout> | null = null
let hooked = false
let users = 0

async function read(): Promise<void> {
  const scope = scopeNow()
  try {
    const info = await tapeInfo(scope)
    useTapeInfo.setState({ scope, info })
  } catch {
    /* the cell keeps what it showed */
  }
}

/** Read again soon (debounced). */
export function refreshTapeInfo(delay = REREAD_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void read()
  }, delay)
}

/** Mount where the tape's size is shown: reads it a moment after boot and keeps it current while mounted. */
export function useTapeInfoLive(): InfoState {
  useEffect(() => {
    users++
    if (!hooked) {
      hooked = true
      onJournalChange(() => {
        if (users > 0) refreshTapeInfo()
      })
    }
    // the first read waits until the journal is open (the recorder opens it on its first slice) or a moment passed
    refreshTapeInfo(journalIfOpen() ? 0 : FIRST_READ_MS)
    return () => {
      users--
    }
  }, [])
  const s = useTapeInfo()
  // another workspace: what was shown belongs to the old one
  if (s.scope && s.scope !== scopeNow()) {
    refreshTapeInfo(0)
    return { scope: null, info: null }
  }
  return s
}

/** Days recorded on this device: since the floor or the first day, at most 30 ("1 Tag" on the first day). */
export function daysRecorded(info: TapeInfo | null, now = Date.now()): number {
  if (!info) return 1
  const start = Math.max(info.first ?? now, info.floor ?? 0)
  return Math.max(1, Math.min(30, Math.floor((now - start) / DAY) + 1))
}

/** This tab records into memory only (no IndexedDB) · recording is paused for room. */
export function recorderMode(): { memory: boolean; paused: boolean } {
  const r = recorder()
  return { memory: !!r?.memory, paused: !!r?.budget.paused }
}
