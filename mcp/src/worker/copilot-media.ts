/** Account-advertised vision, strict in-memory payloads; never paths or URLs. */
import { WORKER_MEDIA_BYTES, WORKER_MEDIA_COUNT, type WorkerAttachment, type WorkerVision } from '../../../src/shared/ai/worker.ts'
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export function visionOf(model: any): WorkerVision | undefined {
  if (model?.capabilities?.supports?.vision !== true) return
  const v = model.capabilities.limits?.vision
  const mediaTypes = TYPES.filter(t => !Array.isArray(v?.supported_media_types) || v.supported_media_types.includes(t))
  if (!mediaTypes.length) return
  return { mediaTypes, maxImages: Math.min(WORKER_MEDIA_COUNT, Number.isSafeInteger(v?.max_prompt_images) && v.max_prompt_images > 0 ? v.max_prompt_images : 1), maxBytes: Math.min(WORKER_MEDIA_BYTES, Number.isSafeInteger(v?.max_prompt_image_size) && v.max_prompt_image_size > 0 ? v.max_prompt_image_size : WORKER_MEDIA_BYTES) }
}
export function checkAttachments(raw: unknown, vision?: WorkerVision): WorkerAttachment[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > WORKER_MEDIA_COUNT) throw new Error('Too many Copilot image attachments.')
  if (raw.length && !vision) throw new Error('This account model does not advertise vision support. Refresh models or choose another model.')
  let bytes = 0
  for (const a of raw) {
    if (!a || typeof a !== 'object' || Object.keys(a).some(k => !['mediaType','data'].includes(k)) || !TYPES.includes(a.mediaType) || typeof a.data !== 'string' || !a.data.length || a.data.length > Math.ceil(WORKER_MEDIA_BYTES / 3) * 4 || (a.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))) throw new Error('Invalid in-memory image attachment.')
    const b = Buffer.from(a.data, 'base64')
    const signature = a.mediaType === 'image/png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : a.mediaType === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255 : a.mediaType === 'image/webp' ? b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' : /^GIF8[79]a/.test(b.toString('ascii',0,6))
    bytes += b.length
    if (!signature || a.data !== b.toString('base64') || bytes > WORKER_MEDIA_BYTES || vision && (!vision.mediaTypes.includes(a.mediaType) || b.length > vision.maxBytes || raw.length > vision.maxImages)) throw new Error('Image type, count or size exceeds this Copilot model’s limits.')
  }
  return raw
}
