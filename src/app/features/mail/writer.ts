/**
 * Who writes mail data (store/writer.ts). Mail work runs one job at a time (syncNow / organiseEarlier / linkNow share
 * `running` and a Web Lock per workspace), so the job's writer is kept here as a value while it runs and every
 * synchronous burst of its writes opens a frame with it — never a frame held across an await. Outside a job: the
 * person (setup, Load images, Load, merging rows); those paths name their writer themselves where a job may run.
 */
import { endRun, noteRun, withWriter, type RunMeta, type Writer } from '../../store/writer'

let current: Writer | null = null

/** Run a mail job as `w` (noted before its first write, ended after its last). */
export async function inMailJob<T>(w: Writer, fn: () => Promise<T>): Promise<T> {
  const was = current
  current = w
  noteRun(w)
  try {
    return await fn()
  } finally {
    current = was
    endRun(w)
  }
}

/** The AI route that answered the job's request (route keys only): told to the recorder before its writes. */
export function noteMailAI(meta: Pick<RunMeta, 'ai' | 'aiAlso'> | undefined): void {
  if (current && meta) noteRun(current, meta)
}

/** The writer of the mail job running now (outside one: the person). */
export const mailWriter = (): Writer => current ?? { kind: 'you', via: 'ui' }

/** A synchronous burst of mail writes as the job's (or the person's). */
export const asMail = <T>(fn: () => T): T => withWriter(mailWriter(), fn)
