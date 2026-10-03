/**
 * Inbox engine — a background service (started once from main.tsx, like recurring templates).
 *
 * Reminders (every workspace): the reminders of date mentions and date properties (scan.ts) are
 * indexed after every change; each one fires once per device at its due time: an inbox item, a
 * toast ("Open"), and — only if switched on in the inbox settings — a browser notification. A
 * reminder this device first sees when it is already past (set on a past date, or while this device
 * was away from a team workspace) is noted, not fired. Reminders that came due while the app was
 * closed fire at the next start, with ONE summary toast. Changing a reminder's date or code makes
 * it a new reminder; trashing the page or removing the reminder cancels it.
 *
 * Team workspaces: "me" is the signed-in account (members are mirrored as people with the account
 * id). Per page a snapshot of what concerns me (my @mentions per block, the person properties I am
 * in, every comment reply id) is kept on this device; the first scan of a workspace is the
 * baseline, later differences become items: someone @mentioned me, I was added to a person
 * property, a new reply in a thread I started or replied to. Comment authors are display names, so
 * "my" threads are matched by my display name. Changes made here are never news: they are told
 * apart by the store (isApplyingRemote) and, for this browser's other tabs, by a hint they send.
 *
 * One tab per workspace runs it (Web Locks); the others show its toasts and reload its data.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { isApplyingRemote } from '../../store/persistence'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { activeWorkspace, useCloud } from '../../cloud'
import { navigate, openPage } from '../../lib/router'
import { t } from '../../i18n'
import { collectReminders, commentBlock, mentionLine, takesPart, teamFacts, type ReminderEntry, type TeamFacts } from './scan'
import { formatDue, hasTime, parseIsoLocal, parseReminder, reminderDueAt, reminderLabel, reminderOptions } from './reminders'
import { loadInbox, loadSnapshot, markRead, mutateInbox, onInboxMessage, postInbox, saveSnapshot, useInbox, wsKey, type InboxData, type InboxItem, type Snapshot } from './state'
import { showNotification } from './notify'

const TICK_MS = 60_000
/** First pass after start: lets the UI (and a team workspace's sync) settle. */
const SETTLE_MS = 1200
/** Changes are gathered for this long before a pass. */
const PASS_DELAY_MS = 300
/** A reminder first seen at most this long after its due time still fires. */
const GRACE_MS = 60_000
/** Fired this long after the due time = missed (the app was closed): summary toast only. */
const MISSED_MS = 2 * 60_000
/** Another tab's own edit of a page arrives here as remote within this window. */
const HINT_MS = 20_000
/** Reminders that are gone for this long are forgotten. */
const FORGET_MS = 45 * 24 * 60 * 60_000

const LOCK = 'one-inbox'

let started = false
let leader = false
let generation = 0
let ws: string | null = null
let releaseLock: (() => void) | null = null
let settleTimer = 0
let passTimer = 0
let dueTimer = 0
let unsubs: Array<() => void> = []
let running: Promise<void> | null = null
let again = false
let booted = false

/**
 * Team (leader only): the snapshot; each store change is diffed against it as it lands (changes made
 * here are absorbed, others' become items in `pending` until the next pass stores them). Before the
 * snapshot is loaded, changed pages wait in `dirty` (true = changed here) for the first pass.
 */
let snap: Snapshot | null = null
let pending: InboxItem[] = []
const dirty = new Map<ID, boolean>()
/** other tabs of this browser: pages they changed (their edits arrive here as remote) */
const hints = new Map<ID, number>()
const hinted = (id: ID, now: number) => (hints.get(id) ?? 0) > now - HINT_MS

/* ------------------------------------------------------------------ helpers */

function teamMe(): { id: ID; name: string } | null {
  const c = useCloud.getState()
  if (c.active.kind !== 'cloud' || !c.user) return null
  const s = useWorkspace.getState()
  const name = s.settings.userName.trim() || s.people.find((p) => p.id === c.user!.id)?.name || ''
  return { id: c.user.id, name }
}

/** Open what an item is about (and mark it read). */
export function openInboxItem(item: InboxItem): void {
  void markRead([item.id])
  const page = useWorkspace.getState().pages[item.pageId]
  if (!page) return
  // a row's property (date reminder, assignment) opens in the peek; content opens the page at the block
  if (page.databaseId && (item.kind === 'assigned' || (item.kind === 'reminder' && item.propId))) useUI.getState().openPeek(page.id)
  else openPage(page.id, item.blockId ?? undefined)
}

export function openInbox(): void {
  navigate({ name: 'inbox' })
}

/** "Mon 5 Oct" / "Mon 5 Oct, 14:30" — the date a reminder is about. */
export function eventLabel(iso: string | undefined, lang: 'en' | 'de'): string {
  const d = parseIsoLocal(iso)
  if (!d || !iso) return iso ?? ''
  const full = formatDue(d.getTime(), lang)
  return hasTime(iso) ? full : full.replace(/,\s*\d{2}:\d{2}$/, '')
}

/* ------------------------------------------------------------------ announce */

function titleOf(id: ID): string {
  return useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')
}

/** Toast (+ notification) for fired reminders: one toast per pass, never a storm. */
function announce(items: InboxItem[], now: number, notify: boolean): void {
  if (!items.length) return
  const lang = useWorkspace.getState().settings.language
  const missed = items.filter((i) => i.at < now - MISSED_MS).length
  const ui = useUI.getState()
  if (items.length === 1 && !missed) {
    const it = items[0]
    const when = eventLabel(it.iso, lang)
    ui.toast({ message: t('inbox.toast.one', { title: titleOf(it.pageId), when }), kind: 'info', timeout: 12_000, action: { label: t('common.open'), run: () => openInboxItem(it) } })
    if (notify) showNotification(titleOf(it.pageId), t('inbox.notify.body', { when }), it.id, () => openInboxItem(it))
    return
  }
  const n = items.length
  const message = missed ? t(n === 1 ? 'inbox.toast.missed.one' : 'inbox.toast.missed', { n }) : t('inbox.toast.many', { n })
  ui.toast({ message, kind: 'info', timeout: 12_000, action: { label: t('inbox.toast.openInbox'), run: openInbox } })
  if (notify) showNotification(t('inbox.title'), message, 'one-inbox-summary', openInbox)
}

/* ------------------------------------------------------------------ reminders */

/** Decide in memory first: only touch IndexedDB when something changes. */
function reminderWork(index: ReminderEntry[], data: InboxData, now: number): { fresh: ReminderEntry[]; due: ReminderEntry[] } {
  const fresh: ReminderEntry[] = []
  const due: ReminderEntry[] = []
  for (const r of index) {
    const st = data.rem[r.key]
    if (!st) fresh.push(r)
    else if (!st.fired && r.dueAt <= now) due.push(r)
  }
  return { fresh, due }
}

function reminderItem(r: ReminderEntry): InboxItem {
  return { id: `r:${r.key}`, kind: 'reminder', pageId: r.pageId, at: r.dueAt, blockId: r.blockId, excerpt: r.excerpt, iso: r.iso, code: r.code, propId: r.propId }
}

/** Apply to a data draft: note new reminders, fire due ones. Returns what fired. */
function applyReminders(d: InboxData, index: ReminderEntry[], now: number, gc: boolean): InboxItem[] {
  const fired: InboxItem[] = []
  for (const r of index) {
    let st = d.rem[r.key]
    if (!st) {
      st = d.rem[r.key] = { seen: now }
      // already past when first seen: a past date, or set while this device was away — no news
      if (r.dueAt < now - GRACE_MS) st.fired = now
    }
    if (st.fired || r.dueAt > now) continue
    st.fired = now
    const item = reminderItem(r)
    d.items = d.items.filter((i) => i.id !== item.id)
    d.items.push(item)
    fired.push(item)
  }
  if (gc) {
    const keys = new Set(index.map((r) => r.key))
    for (const [k, st] of Object.entries(d.rem)) if (!keys.has(k) && Math.max(st.seen, st.fired ?? 0) < now - FORGET_MS) delete d.rem[k]
  }
  return fired
}

/* ------------------------------------------------------------------ team */

function empty(): TeamFacts {
  return { m: [], a: [], r: [] }
}

/** Multiset difference: occurrences in `cur` beyond those in `old`, with their running count. */
function added(cur: Array<string | null>, old: Array<string | null>): Array<{ block: string | null; n: number }> {
  const left = new Map<string | null, number>()
  for (const b of old) left.set(b, (left.get(b) ?? 0) + 1)
  const count = new Map<string | null, number>()
  const out: Array<{ block: string | null; n: number }> = []
  for (const b of cur) {
    const n = (count.get(b) ?? 0) + 1
    count.set(b, n)
    if (n > (left.get(b) ?? 0)) out.push({ block: b, n })
  }
  return out
}

/**
 * Diff one page against the snapshot and update it. `own`: the change was made here — absorbed,
 * no items (a reply by someone else is still news: replies carry their author).
 */
function diffPage(me: { id: ID; name: string }, id: ID, own: boolean, baselineAt: number, now: number): InboxItem[] {
  const s = useWorkspace.getState()
  const items: InboxItem[] = []
  if (!snap) return items
  const page = s.pages[id]
  if (!page) {
    delete snap[id]
    return items
  }
  const db = page.databaseId ? s.databases[page.databaseId] : undefined
  const cur = teamFacts(page, db, me.id)
  let old = snap[id]
  // content not loaded (yet): keep what was known of it
  snap[id] = cur.m === undefined && old?.m !== undefined ? { ...cur, m: old.m } : cur
  if (isEffectivelyTrashed(s.pages, id)) return items
  if (!old) {
    // first sight: what existed at the baseline is no news; a page made since then is
    if (page.createdAt <= baselineAt) return items
    old = empty()
  }
  if (!own) {
    // @mentions (content loaded; an old page's first content is the baseline)
    if (cur.m && (old.m || page.createdAt > baselineAt))
      for (const { block, n } of added(cur.m, old.m ?? []))
        items.push({ id: `m:${id}:${block ?? '-'}:${n}`, kind: 'mention', pageId: id, at: now, blockId: block, excerpt: mentionLine(page, me.id, block) })
    // person properties
    for (const propId of cur.a)
      if (!old.a.includes(propId)) items.push({ id: `a:${id}:${propId}`, kind: 'assigned', pageId: id, at: now, propId, excerpt: db?.properties.find((p) => p.id === propId)?.name ?? '' })
  }
  // replies by others in threads I take part in
  const seen = new Set(old.r)
  for (const thread of page.comments ?? [])
    for (const reply of thread.replies ?? []) {
      if (seen.has(reply.id) || reply.author.trim() === me.name || !takesPart(thread, me.name, reply.id)) continue
      const body = reply.body.replace(/\s+/g, ' ').trim()
      items.push({
        id: `c:${reply.id}`,
        kind: 'comment',
        pageId: id,
        at: Math.min(now, reply.createdAt || now),
        actor: reply.author.trim(),
        excerpt: body.length > 140 ? `${body.slice(0, 139)}…` : body,
        threadId: thread.id,
        blockId: commentBlock(page, thread.id),
      })
    }
  return items
}

/* ------------------------------------------------------------------ one pass */

async function pass(now = Date.now()): Promise<void> {
  const s = useWorkspace.getState()
  const st = useInbox.getState()
  if (!leader || !s.ready || !st.loaded || st.ws !== ws) return
  const boot = !booted
  booted = true

  // reminders
  const index = collectReminders(s.pages, s.databases)
  const work = reminderWork(index, st.data, now)

  // team items
  let teamItems: InboxItem[] = []
  const me = teamMe()
  if (me) {
    if (!snap) {
      snap = (await loadSnapshot(ws!)) ?? {}
      // a device without a snapshot starts its baseline now (even if its data is older)
      if (!Object.keys(snap).length) await mutateInbox((d) => void (d.baselineAt = now))
    }
    // the first pass: everything (changes since the last session); later the changes that waited
    const baselineAt = useInbox.getState().data.baselineAt
    const ids = boot ? Object.keys({ ...snap, ...s.pages }) : [...dirty.keys()]
    for (const id of ids) teamItems.push(...diffPage(me, id, dirty.get(id) === true || hinted(id, now), baselineAt, now))
    dirty.clear()
    teamItems.push(...pending)
    pending = []
    if (!teamItems.length) scheduleSnapshotSave()
  }

  let fired: InboxItem[] = []
  if (work.fresh.length || work.due.length || teamItems.length || boot) {
    const res = await mutateInbox((d) => {
      const f = applyReminders(d, index, now, boot)
      for (const it of teamItems) {
        // the same mention / assignment again (removed and re-added): back to unread, on top
        d.items = d.items.filter((i) => i.id !== it.id)
        d.items.push(it)
      }
      return f
    })
    fired = res ?? []
    if (teamItems.length && snap) await saveSnapshot(ws!, snap)
  }
  if (fired.length) {
    announce(fired, now, useInbox.getState().data.notify)
    postInbox({ type: 'fired', ws: ws!, items: fired, now })
  }
  if (teamItems.length) notifyTeam(teamItems)
  scheduleDue(index, now)
}

function notifyTeam(items: InboxItem[]): void {
  if (!useInbox.getState().data.notify) return
  const first = items[0]
  const body = items.length === 1 ? `${titleOf(first.pageId)} — ${first.excerpt ?? ''}` : t('inbox.notify.many', { n: items.length })
  showNotification(t(`inbox.kind.${first.kind}`), body, items.length === 1 ? first.id : 'one-inbox-team', () => (items.length === 1 ? openInboxItem(first) : openInbox()))
}

/** Next wake-up: the next due reminder, at most a minute away. */
function scheduleDue(index: ReminderEntry[], now: number): void {
  window.clearTimeout(dueTimer)
  if (!leader) return
  const rem = useInbox.getState().data.rem
  const next = index.find((r) => r.dueAt > now && !rem[r.key]?.fired)
  const wait = next ? Math.min(TICK_MS, Math.max(250, next.dueAt - now + 50)) : TICK_MS
  dueTimer = window.setTimeout(() => runPass(), wait)
}

let snapTimer = 0
function scheduleSnapshotSave(): void {
  window.clearTimeout(snapTimer)
  snapTimer = window.setTimeout(() => {
    if (snap && ws) void saveSnapshot(ws, snap)
  }, 1000)
}

/** Serialised passes: a request while one runs schedules exactly one more. */
function runPass(now?: number): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = pass(now)
    .catch((e) => console.error('[one] inbox pass failed', e))
    .finally(() => {
      running = null
      if (again) {
        again = false
        void runPass()
      }
    })
  return running
}

function schedulePass(): void {
  if (!leader) return
  window.clearTimeout(passTimer)
  passTimer = window.setTimeout(() => runPass(), PASS_DELAY_MS)
}

/* ------------------------------------------------------------------ service */

function onStore(state: ReturnType<typeof useWorkspace.getState>, prev: ReturnType<typeof useWorkspace.getState>): void {
  if (!state.ready || (state.pages === prev.pages && state.databases === prev.databases)) return
  const me = state.pages !== prev.pages ? teamMe() : null
  if (me) {
    const own = !isApplyingRemote()
    const ids: ID[] = []
    for (const id in state.pages) if (state.pages[id] !== prev.pages[id]) ids.push(id)
    for (const id in prev.pages) if (!state.pages[id]) ids.push(id)
    const now = Date.now()
    if (!leader) {
      if (own && ids.length && ws) postInbox({ type: 'local', ws, ids, at: now })
    } else if (snap) {
      // classified the moment it lands: a change made here never becomes news
      const baselineAt = useInbox.getState().data.baselineAt
      for (const id of ids) pending.push(...diffPage(me, id, own || hinted(id, now), baselineAt, now))
      scheduleSnapshotSave()
    } else for (const id of ids) dirty.set(id, own || dirty.get(id) === true)
  }
  schedulePass()
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void runPass()
  else if (snap && ws && leader) void saveSnapshot(ws, snap)
}

function lead(gen: number): void {
  if (gen !== generation) return
  leader = true
  booted = false
  settleTimer = window.setTimeout(() => runPass(), SETTLE_MS)
}

/**
 * Start the inbox (idempotent): loads this device's inbox of the open workspace, then one tab
 * per workspace (Web Locks) runs the scheduler. Call once after the workspace is loaded.
 */
export function startInbox(): () => void {
  if (started) return stopInbox
  started = true
  const gen = ++generation
  ws = wsKey(activeWorkspace())
  const key = ws
  void loadInbox(key).then(() => gen === generation && schedulePass())

  unsubs.push(useWorkspace.subscribe(onStore))
  unsubs.push(
    onInboxMessage((msg) => {
      if (msg.ws !== key) return
      if (msg.type === 'changed') void loadInbox(key)
      else if (msg.type === 'fired' && !leader && document.visibilityState === 'visible') announce(msg.items, msg.now, false)
      else if (msg.type === 'local' && leader) for (const id of msg.ids) hints.set(id, msg.at)
    }),
  )
  document.addEventListener('visibilitychange', onVisible)

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) lead(gen)
  else
    locks
      .request(`${LOCK}:${key}`, () =>
        new Promise<void>((resolve) => {
          if (gen !== generation) return resolve()
          releaseLock = resolve
          lead(gen)
        }),
      )
      .catch((e) => console.warn('[one] inbox: no tab lock', e))
  return stopInbox
}

export function stopInbox(): void {
  if (!started) return
  started = false
  leader = false
  generation++
  if (snap && ws) void saveSnapshot(ws, snap)
  snap = null
  pending = []
  dirty.clear()
  hints.clear()
  window.clearTimeout(settleTimer)
  window.clearTimeout(passTimer)
  window.clearTimeout(dueTimer)
  window.clearTimeout(snapTimer)
  releaseLock?.()
  releaseLock = null
  unsubs.forEach((u) => u())
  unsubs = []
  document.removeEventListener('visibilitychange', onVisible)
}

// Test hook (dev, or ?e2e): start / stop without main.tsx, one pass now (regardless of leadership).
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneInbox?: unknown }).__oneInbox = {
    start: startInbox,
    stop: stopInbox,
    isLeader: () => leader,
    /** the leader has made its first pass (a team workspace's baseline exists) */
    isBooted: () => leader && booted && !running,
    run: async (now?: number) => {
      const was = leader
      leader = true
      try {
        await runPass(now)
      } finally {
        leader = was
      }
    },
    data: () => useInbox.getState().data,
    reminders: () => collectReminders(useWorkspace.getState().pages, useWorkspace.getState().databases),
    codes: {
      parse: parseReminder,
      dueAt: reminderDueAt,
      label: (code: string, timed: boolean) => reminderLabel(code, timed, t),
      options: reminderOptions,
    },
  }
}
