/** Native CLI agents cannot call the local adapter's finish_task. Their final review uses the same verdicts. */
export function deliveryReview(text: string): { status: 'completed' | 'blocked' | 'needs_rework'; summary: string; next: string } | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  try {
    const raw = JSON.parse(blocks.at(-1)?.[1] ?? text.trim())
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['status', 'summary', 'next'].includes(k))) return null
    if (!['completed', 'blocked', 'needs_rework'].includes(raw.status) || typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 12000 || typeof raw.next !== 'string' || raw.next.length > 2000) return null
    return { status: raw.status, summary: raw.summary, next: raw.next }
  } catch { return null }
}
