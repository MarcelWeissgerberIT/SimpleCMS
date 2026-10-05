/**
 * One Script — the dialogs a run asks for (modal / confirm / ask / choose, the list of effects before a
 * run, one more effect, more time, a team script someone else changed), queued in a small store. The
 * app's ScriptDialogHost shows them one at a time; a run waits for the answer (Stop / Esc = cancel).
 */
import { create } from 'zustand'
import { toast } from '../../../store/ui'
import type { ConfirmItem, RunUI } from './types'

export type DialogRequest =
  | { type: 'modal'; text: string; buttons: string[] }
  | { type: 'confirm'; text: string }
  | { type: 'ask'; text: string; def: string }
  | { type: 'choose'; text: string; options: string[] }
  | { type: 'plan'; items: ConfirmItem[]; scriptName: string }
  | { type: 'one'; item: ConfirmItem; scriptName: string }
  | { type: 'time'; scriptName: string }
  | { type: 'trust'; name: string; editor: string | null; code: string }

export interface PendingDialog {
  id: number
  req: DialogRequest
  resolve: (answer: unknown) => void
}

export const useScriptDialogs = create<{ queue: PendingDialog[] }>()(() => ({ queue: [] }))

let seq = 0

function ask<T>(req: DialogRequest, signal: AbortSignal, cancel: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(cancel)
  return new Promise<T>((resolve) => {
    const id = ++seq
    const done = (answer: unknown) => {
      signal.removeEventListener('abort', onAbort)
      useScriptDialogs.setState((s) => ({ queue: s.queue.filter((d) => d.id !== id) }))
      resolve(answer as T)
    }
    const onAbort = () => done(cancel)
    signal.addEventListener('abort', onAbort)
    useScriptDialogs.setState((s) => ({ queue: [...s.queue, { id, req, resolve: done }] }))
  })
}

/** Answer the dialog on top (the host calls it). */
export function answerDialog(id: number, answer: unknown): void {
  useScriptDialogs.getState().queue.find((d) => d.id === id)?.resolve(answer)
}

/** The app's dialogs for runs started anywhere (editor, buttons, automations …). */
export const appRunUI: RunUI = {
  modal: (text, buttons, signal) => ask({ type: 'modal', text, buttons }, signal, null),
  confirm: (text, signal) => ask({ type: 'confirm', text }, signal, false),
  ask: (text, def, signal) => ask({ type: 'ask', text, def }, signal, null),
  choose: (text, options, signal) => ask({ type: 'choose', text, options }, signal, null),
  notify: (text) => void toast(text),
  confirmPlan: (items, scriptName, signal) => ask<Set<string> | null>({ type: 'plan', items, scriptName }, signal, null),
  allowOne: (item, scriptName, signal) => ask<boolean | 'all'>({ type: 'one', item, scriptName }, signal, false),
  moreTime: (scriptName, signal) => ask({ type: 'time', scriptName }, signal, false),
  trust: (info, signal) => ask({ type: 'trust', ...info }, signal, false),
}

/** The check pass before a run: every question gets its default answer, nobody is asked. */
export const silentRunUI: RunUI = {
  modal: async (_t, buttons) => buttons[0] ?? null,
  confirm: async () => true,
  ask: async (_t, def) => def,
  choose: async (_t, options) => options[0] ?? null,
  notify: () => {},
  confirmPlan: async (items) => new Set(items.filter((i) => i.on).map((i) => i.key)),
  allowOne: async () => false,
  moreTime: async () => false,
  trust: async () => false,
}
