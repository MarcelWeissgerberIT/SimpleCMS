import { AgentReportDialog } from './AgentReportDialog'
/**
 * Custom agents — the dialogs AgentDialogsHost renders over any route (a lazy chunk: MirrorSetup and the AgentEditor
 * load with it, never at boot). The Patchbay's setup lamps open them (plan §1.11, §6 U2) without leaving #/patchbay:
 *  - MirrorSetup for a profile's recipe (lamp 04, and 05 when the draft was lost): source, name, place, Restore, "Use …"
 *    stay MirrorSetup's own. Create closes it — the database and report page are made, the agent draft is KEPT in this
 *    tab (dialogs.ts) and lamp 05 opens it; "Open <agent>" leaves for that agent's page as in the gallery.
 *  - the AgentEditor for a saved agent or a kept mirror draft (lamp 05): the draft's note says what the setup made and
 *    carries its Undo; closing it unsaved asks as in the gallery (MirrorDiscard: keep editing · discard, keep both ·
 *    both to the trash); saved, the dialog closes and the route stays.
 * Closing gives focus back to the opener (`req.from`, the lamp's key — handed to the dialog as it opens, ui/Modal.tsx
 * gives it back), then `req.after(outcome)` runs: the Patchbay moves focus on to the next lamp's key after a create or
 * a save. Nothing here writes but the dialogs themselves (createMirror / reuseMirror / upsertAgent, their own writers).
 */
import { AgentRunDialog } from './AgentRunDialog'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../store/store'
import { matchingServers } from '../../store/integrations'
import type { CustomAgent } from '../../store/types'
import { useT } from '../../i18n'
import { canFocus, focusLost, handFocusOver, restoreFocus } from '../../ui/focus'
import { closeAgentDialog, dropMirrorDraft, keepMirrorDraft, keptDraft, type AgentDialogOutcome, type AgentDialogRequest, type KeptDraft } from './dialogs'
import { MirrorSetup, type RecipeSource } from './MirrorSetup'
import { AgentEditor } from './AgentEditor'
import { MirrorDiscard, MirrorUndoAsk } from './MirrorDiscard'
import { madeKind, undoMirror } from './mirror'
import { introText, mirrorUndoTitle, trashWithUndo } from './mirrorFlow'
import { deviceServers } from './integrations/status'

type Req = AgentDialogRequest['req']

/** The lamp's key takes the dialog's focus-back (ui/Modal.tsx takes what has focus as it opens, else a handed-over key). */
function useOpener(from: HTMLElement | null | undefined): void {
  // a layout effect: it runs before the Modal's own (passive) effect reads the opener
  useLayoutEffect(() => {
    if (from && canFocus(from) && document.activeElement !== from && focusLost()) handFocusOver(from)
  }, [from])
}

/** Close this request; once the Modal gave focus back (two frames), make sure it is on the opener and tell the caller. */
function finish(seq: number, req: Req, outcome: AgentDialogOutcome): void {
  closeAgentDialog(seq)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (focusLost() && req.from && canFocus(req.from)) restoreFocus(req.from)
      req.after?.(outcome)
    }),
  )
}

/* ------------------------------------------------------------------ MirrorSetup */

const recipeIdOf = (r: { id?: string }) => r.id ?? 'mirror'

/** The profile's recipe as the gallery hands it over (read once as the dialog opens — as the gallery does). */
function sourceOf(profileId: string, recipeId: string | undefined): RecipeSource | null {
  const s = useWorkspace.getState()
  const profile = (s.integrations ?? []).find((p) => p.id === profileId)
  const recipes = profile?.recipes ?? []
  const recipe = recipeId ? recipes.find((r) => recipeIdOf(r) === recipeId) : recipes[0]
  if (!profile || !recipe) return null
  return { profile, recipe, servers: matchingServers(profile, deviceServers(s.settings)) }
}

function MirrorSetupDialog({ request }: { request: Extract<AgentDialogRequest, { kind: 'mirrorSetup' }> }) {
  const { req, seq } = request
  const [source] = useState(() => sourceOf(req.profileId, req.recipeId))
  useOpener(req.from)
  // the profile or its recipe is gone: nothing to show
  useEffect(() => {
    if (!source) finish(seq, req, { kind: 'closed' })
  }, [source, seq, req])
  if (!source) return null
  return (
    <MirrorSetup
      source={source}
      {...(req.name ? { initialName: req.name } : {})}
      // a step of the setup (fix ui-words): Create makes the database and its report page — the agent is lamp 05's
      step
      onClose={() => finish(seq, req, { kind: 'closed' })}
      onCreated={(made) => {
        // the draft waits for lamp 05 (the editor), in this tab
        keepMirrorDraft(made, source.profile.id, recipeIdOf(source.recipe))
        finish(seq, req, { kind: 'created', dbId: made.dbId, draftId: made.draft.id })
      }}
    />
  )
}

/* ------------------------------------------------------------------ the editor */

interface Opened {
  agent: CustomAgent
  isNew: boolean
  kept?: KeptDraft
}

/** What the editor opens with: a saved agent (by id or object), else a kept mirror draft, else the draft given. */
function openedOf(target: string | CustomAgent): Opened | null {
  const saved = useWorkspace.getState().agents ?? {}
  if (typeof target === 'string') {
    if (saved[target]) return { agent: saved[target], isNew: false }
    const k = keptDraft(target)
    return k ? { agent: k.made.draft, isNew: true, kept: k } : null
  }
  return saved[target.id] ? { agent: saved[target.id], isNew: false } : { agent: target, isNew: true }
}

function EditorDialog({ request }: { request: Extract<AgentDialogRequest, { kind: 'agentEditor' }> }) {
  const t = useT()
  const { req, seq } = request
  const [opened] = useState(() => openedOf(request.agent))
  useOpener(req.from)
  const made = opened?.kept?.made
  const madeHere = made ? madeKind(made) : 'none'
  // closing a mirror draft unsaved asks first when its setup created something; focus goes back where it was
  const [discarding, setDiscarding] = useState(false)
  // the note's Undo on a draft that was changed asks first too (the changes would be lost)
  const [undoing, setUndoing] = useState(false)
  const back = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!opened) finish(seq, req, { kind: 'closed' })
  }, [opened, seq, req])
  // closing the tab with a draft whose setup made pages: the browser asks
  useEffect(() => {
    if (madeHere === 'none') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [madeHere])
  if (!opened) return null

  const done = (outcome: AgentDialogOutcome) => finish(seq, req, outcome)
  const holdFocus = () => {
    const active = document.activeElement
    back.current = active instanceof HTMLElement && active.closest('.agx-editor') ? active : document.querySelector<HTMLElement>('.agx-editor')
  }
  const close = () => {
    if (made) dropMirrorDraft(made.draft.id)
    done({ kind: 'closed' })
  }
  const ask = () => {
    // nothing this setup made (a database and report page that were there): nothing to ask about
    if (madeHere === 'none') return close()
    holdFocus()
    setDiscarding(true)
  }
  const keep = () => {
    setDiscarding(false)
    setUndoing(false)
    requestAnimationFrame(() => restoreFocus(back.current))
  }
  const discard = (trash: boolean) => {
    setDiscarding(false)
    if (made && trash) trashWithUndo(made)
    close()
  }
  // the note's Undo: what the setup made goes to the trash (Undo in the toast), and the draft with it
  const undoNow = () => {
    setUndoing(false)
    if (!made) return
    dropMirrorDraft(made.draft.id)
    trashWithUndo(made, undoMirror(made))
    done({ kind: 'closed' })
  }
  const undo = (dirty: boolean) => {
    if (!dirty) return undoNow()
    holdFocus()
    setUndoing(true)
  }

  return (
    <>
      <AgentEditor
        initial={opened.agent}
        isNew={opened.isNew}
        section={req.section}
        intro={made ? introText(t, made) : undefined}
        introUndo={made && madeHere !== 'none' ? { title: mirrorUndoTitle(t, made), run: undo } : undefined}
        writeHint={made ? t('features.agents.mirror.writeHint') : undefined}
        onClose={ask}
        onSaved={(id) => {
          if (made) dropMirrorDraft(made.draft.id)
          done({ kind: 'saved', agentId: id })
        }}
      />
      {/* closing both at once, focus goes back to the editor's opener whichever dialog closes first (ui/Modal.tsx) */}
      {discarding && made && <MirrorDiscard made={made} onKeep={keep} onDiscard={discard} />}
      {undoing && made && <MirrorUndoAsk made={made} onKeep={keep} onUndo={undoNow} />}
    </>
  )
}

export default function AgentDialogs({ request }: { request: AgentDialogRequest }) {
  if (request.kind === 'agentReport') return <AgentReportDialog key={request.seq} request={request} />
  if (request.kind === 'agentRun') return <AgentRunDialog key={request.seq} request={request} />
  return request.kind === 'mirrorSetup' ? <MirrorSetupDialog key={request.seq} request={request} /> : <EditorDialog key={request.seq} request={request} />
}
