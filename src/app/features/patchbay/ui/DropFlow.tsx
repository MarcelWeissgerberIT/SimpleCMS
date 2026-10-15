/**
 * The profile drop on the page (plan §1.12, §3.7, §6 U25 / U4): the ways in and what each answers.
 *  - DropZone.tsx: while a file hovers the page, the bench shows a dashed zone — "Release to check the profile" for a
 *    JSON file, "Only .integration.json" for any other type (the drop then says so in the plate);
 *  - the head's chip (DropChip): a menu "Choose a file …" · "Paste the profile …"; a team member without the rights
 *    gets the explanation instead (the owners and admins named) with the existing profiles' "Set up in the Patchbay";
 *  - PasteProfile.tsx: a dialog with the shared CodeArea (never a plain textarea) — problems marked at their line;
 *  - DropPlate: under the head, the first problems of a file that is no valid profile ("line 3:14 — …", "+n more") with
 *    "Choose a file", or the confirm row of a profile whose id is there already ("Replaces “Tracker”" · Replace).
 * A drop that holds: a toast with Undo ("removes the profile for all members" in a team), the polite region says
 * "Profile “Tracker” dropped · 04 next", the keyboard goes to the next lamp's key. `runDropUndo` is the one Undo of a
 * drop (Mod+Z on the route, the band's key, the toast) — refused once a lamp step made something.
 */
import { useCallback, useRef, useState, type RefObject } from 'react'
import { ClipboardPaste, FileJson, FileUp, X } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { Menu, type MenuEntry } from '../../../ui/Menu'
import { Popover } from '../../../ui/Popover'
import { focusLost, restoreFocus } from '../../../ui/focus'
import { t as tNow } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { checkDropText, commitDrop, dropRefusal, isProfileName, readDropFile, undoDrop, type DropReady, type DropRefusal } from '../setup/drop'
import { lampsNow } from '../setup/facts'
import { setOf } from '../setup/lamps'
import { focusLampKey } from '../setup/focus'
import { lampNo } from '../setup/keys'
import { openPatchbay } from '../open'
import { announce } from './store'

const P = 'features.patchbay'

/* ------------------------------------------------------------------ undo */

/** Take the drop back (Mod+Z, the band's key, the toast): said, a toast, the keyboard to the chip (else the title). */
export function runDropUndo(): boolean {
  const t = tNow
  const name = (id: string) => useWorkspace.getState().integrations?.find((p) => p.id === id)?.name ?? id
  const r = undoDrop()
  if (!r.ok) {
    if (r.why === 'nothing') return false
    const said =
      r.why === 'started'
        ? t(`${P}.drop.undo.started`)
        : r.why === 'changed'
          ? t(`${P}.drop.undo.changed`)
          : r.why === 'rights'
            ? r.names?.length
              ? t(`${P}.drop.fail.rights`, { names: r.names.join(', ') })
              : t(`${P}.drop.fail.rightsNone`)
            : r.why === 'readOnly'
              ? t(`${P}.drop.fail.readOnly`)
              : t(`${P}.drop.undo.failed`)
    announce(said)
    useUI.getState().toast({ message: said, kind: 'error' })
    return true
  }
  const said = r.restored ? t(`${P}.drop.undoneRestored`, { name: name(r.profileId) }) : t(`${P}.drop.undone`, { name: r.profileId })
  announce(said)
  useUI.getState().toast({ message: said, kind: 'success' })
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!focusLost() && !document.activeElement?.closest('[data-testid="patchbay-page"]')) return
      const chip = document.querySelector<HTMLElement>('[data-testid="pb-drop"], [data-testid="pb-more"]')
      if (chip) restoreFocus(chip)
      else document.querySelector<HTMLElement>('[data-testid="patchbay-page"] h1')?.focus()
    }),
  )
  return true
}

/* ------------------------------------------------------------------ the flow */

export interface DropFlow {
  /** the plate under the head: a refusal, or the confirm row of a replace */
  plate: DropRefusal | DropReady | null
  closePlate: () => void
  /** the hidden file input (the chip's "Choose a file", the plate's key) */
  fileRef: RefObject<HTMLInputElement | null>
  pickFile: () => void
  onFiles: (files: FileList | File[] | null) => void
  paste: boolean
  openPaste: () => void
  closePaste: () => void
  /** a checked profile from the paste dialog (its replace confirm stays in the dialog) */
  commit: (ready: DropReady, from?: Element | null) => boolean
}

/** A drop that holds: the toast with Undo, the polite words, the keyboard on the next lamp's key. */
function afterDrop(t: Translate, ready: DropReady, from: Element | null | undefined): void {
  const r = commitDrop(ready)
  if (!r.ok) return
  const p = r.done.wrote
  const now = lampsNow(p.id)
  const set = now ? setOf(now.sets, p.recipes?.[0]?.id ?? null) : null
  const next = set?.next ?? null
  const msg = t(ready.replaces ? `${P}.drop.doneReplaced` : `${P}.drop.done`, { name: p.name })
  announce(next ? t(`${P}.drop.doneSay`, { name: p.name, next: lampNo(next.n) }) : msg)
  useUI.getState().toast({
    message: msg,
    kind: 'success',
    ...(r.done.team ? { detail: t(`${P}.band.removesForAll`) } : {}),
    action: { label: t('common.undo'), undo: true, run: () => void runDropUndo() },
  })
  // the page may not be the route (Paste from ⋯ on the phone stays here): the band shows on #/patchbay
  if (!window.location.hash.startsWith('#/patchbay')) openPatchbay({ setup: p.id })
  if (next) void focusLampKey(next, { profile: p.id, from: from ?? null, waitMs: 2500 })
}

export function useDropFlow(t: Translate): DropFlow {
  const [plate, setPlate] = useState<DropRefusal | DropReady | null>(null)
  const [paste, setPaste] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const show = useCallback((p: DropRefusal | DropReady) => {
    setPlate(p)
    // the plate takes the keyboard (its heading) and is said
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="pb-dropplate"] [data-pb-plate-h]')?.focus({ preventScroll: false }))
  }, [])

  const take = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return
      const pre = dropRefusal()
      if (pre) return show({ ...pre, file: file.name })
      const read = await readDropFile(file)
      if (!read.ok) return show(read)
      const check = checkDropText(read.text, read.file)
      if (!check.ok) return show(check)
      // an id that is there already: asked first (the plate's confirm row)
      if (check.replaces) return show(check)
      setPlate(null)
      afterDrop(t, check, document.activeElement)
    },
    [t, show],
  )

  const onFiles = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : []
      void take(list.find((f) => isProfileName(f.name)) ?? list[0])
    },
    [take],
  )

  const pickFile = useCallback(() => {
    const pre = dropRefusal()
    if (pre) return show(pre)
    fileRef.current?.click()
  }, [show])

  const commit = useCallback(
    (ready: DropReady, from?: Element | null) => {
      const pre = dropRefusal()
      if (pre) {
        show({ ...pre, ...(ready.file ? { file: ready.file } : {}) })
        return false
      }
      setPlate(null)
      afterDrop(t, ready, from)
      return true
    },
    [t, show],
  )

  return {
    plate,
    closePlate: () => {
      setPlate(null)
      requestAnimationFrame(() => {
        if (focusLost()) document.querySelector<HTMLElement>('[data-testid="pb-drop"], [data-testid="pb-more"], [data-testid="patchbay-page"] h1')?.focus()
      })
    },
    fileRef,
    pickFile,
    onFiles,
    paste,
    openPaste: () => {
      const pre = dropRefusal()
      if (pre) return show(pre)
      setPaste(true)
    },
    closePaste: () => setPaste(false),
    commit,
  }
}

/* ------------------------------------------------------------------ the plate */

/** A refusal in words (the plate's line). */
export function refusalText(t: Translate, r: DropRefusal): string {
  switch (r.why) {
    case 'type':
      return t(`${P}.drop.fail.type`)
    case 'size':
      return t(`${P}.drop.fail.size`)
    case 'read':
      return t(`${P}.drop.fail.read`)
    case 'rights':
      return r.names?.length ? t(`${P}.drop.fail.rights`, { names: r.names.join(', ') }) : t(`${P}.drop.fail.rightsNone`)
    case 'limit':
      return t(`${P}.drop.fail.limit`)
    case 'readOnly':
      return t(`${P}.drop.fail.readOnly`)
    case 'failed':
      return t(`${P}.drop.fail.failed`)
    case 'invalid': {
      const n = r.problems.length + r.more
      return t(n === 1 ? `${P}.drop.fail.invalid.one` : `${P}.drop.fail.invalid`, { n })
    }
  }
}

/** Under the head: what was wrong with a dropped profile (its first problems), or the confirm row of a replace. */
export function DropPlate({ t, flow }: { t: Translate; flow: DropFlow }) {
  const p = flow.plate
  if (!p) return null
  if (p.ok) {
    return (
      <section className="pb-dropplate pb-dropplate--ask" role="group" aria-labelledby="pb-dropplate-h" data-testid="pb-dropplate">
        <p className="pb-dropplate__h" id="pb-dropplate-h" tabIndex={-1} data-pb-plate-h="">
          <FileJson size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{t(`${P}.band.replaces`, { name: p.replaces?.name ?? p.profile.id })}</span>
        </p>
        <p className="pb-dropplate__line">{t(`${P}.drop.replace.ask`, { id: p.profile.id })}</p>
        <div className="pb-dropplate__keys">
          <button type="button" className="btn btn--primary btn--sm" onClick={(e) => flow.commit(p, e.currentTarget)} data-testid="pb-drop-replace">
            {t(`${P}.drop.replace.go`)}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={flow.closePlate}>
            {t('common.cancel')}
          </button>
        </div>
      </section>
    )
  }
  return (
    <section className="pb-dropplate" role="alert" aria-labelledby="pb-dropplate-h" data-testid="pb-dropplate" data-why={p.why}>
      <p className="pb-dropplate__h" id="pb-dropplate-h" tabIndex={-1} data-pb-plate-h="">
        <span className="led pb-led--warn" aria-hidden="true" />
        <span>{p.file ? t(`${P}.drop.fail.head`, { file: p.file }) : t(`${P}.drop.fail.headPlain`)}</span>
      </p>
      <p className="pb-dropplate__line">{refusalText(t, p)}</p>
      {p.problems.length > 0 && (
        <ol className="pb-dropplate__list" data-testid="pb-drop-problems">
          {p.problems.map((x, i) => (
            <li key={i}>
              <span className="pb-dropplate__at">{t(`${P}.drop.fail.at`, { line: x.line, col: x.col })}</span>
              <span>{x.message}</span>
            </li>
          ))}
          {p.more > 0 && <li className="pb-dropplate__more">{t(`${P}.drop.fail.more`, { n: p.more })}</li>}
        </ol>
      )}
      <div className="pb-dropplate__keys">
        {p.why !== 'rights' && p.why !== 'readOnly' && p.why !== 'limit' && (
          <button type="button" className="btn btn--sm" onClick={flow.pickFile} data-testid="pb-drop-choose">
            <FileUp size={13} strokeWidth={1.75} aria-hidden="true" />
            {t(`${P}.drop.fail.choose`)}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--sm pb-dropplate__x" aria-label={t(`${P}.drop.fail.close`)} title={t(`${P}.drop.fail.close`)} onClick={flow.closePlate}>
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ the chip */

/**
 * The head's "Drop a profile here" chip, opened at `anchor` (the chip, or ⋯ when the head folded it): a menu — Choose a
 * file · Paste — or, for a team member without the rights, who can drop one and the profiles that can be set up.
 */
export function DropChip({ t, anchor, onClose, flow }: { t: Translate; anchor: HTMLElement | null; onClose: () => void; flow: DropFlow }) {
  const refused = anchor ? dropRefusal() : null
  const profiles = useWorkspace((s) => s.integrations ?? [])
  if (refused?.why === 'rights' || refused?.why === 'readOnly') {
    const names = refused.names ?? []
    return (
      <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="pb-members" role="dialog" aria-label={t(`${P}.drop.members.head`)}>
        <div className="pb-members__in" data-testid="pb-drop-members">
          <p className="pb-members__h">{t(`${P}.drop.members.head`)}</p>
          <p className="pb-members__line">{names.length ? t(`${P}.drop.members.names`, { names: names.join(', ') }) : t(`${P}.drop.members.none`)}</p>
          <p className="label pb-members__sub">{profiles.length ? t(`${P}.drop.members.setUp`) : t(`${P}.drop.members.empty`)}</p>
          {profiles.length > 0 && (
            <ul className="pb-members__list">
              {profiles.map((p) => (
                <li key={p.id}>
                  <span className="pb-members__name">{p.name}</span>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => {
                      onClose()
                      openPatchbay({ setup: p.id, band: true })
                    }}
                    aria-label={`${t(`${P}.drop.setUpKey`)}: ${p.name}`}
                    data-testid="pb-members-setup"
                  >
                    {t(`${P}.drop.setUpKey`)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popover>
    )
  }
  const entries: MenuEntry[] = [
    { label: t(`${P}.drop.file`), icon: <FileUp size={14} />, onSelect: flow.pickFile },
    { label: t(`${P}.drop.paste`), icon: <ClipboardPaste size={14} />, onSelect: flow.openPaste },
  ]
  return <Menu open={!!anchor} anchor={anchor} onClose={onClose} entries={entries} placement="bottom-end" width={240} />
}
