/** Small instrument parts shared by import/export: segmented LED meter and odometer readout. */

const SEGMENTS = 28

/** Segmented bar graph (like a VU meter). value 0..1 */
export function Meter({ value, segments = SEGMENTS }: { value: number; segments?: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments)
  return (
    <span className="io-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} data-on={i < lit || undefined} data-head={(i === lit - 1 && lit < segments) || undefined} />
      ))}
    </span>
  )
}

/** Zero-padded counter: "042" with the leading zeros dimmed. */
export function Readout({ value, label, digits = 3 }: { value: number; label: string; digits?: number }) {
  const s = String(Math.max(0, Math.floor(value)))
  const padded = s.padStart(digits, '0')
  const lead = padded.length - s.length
  return (
    <div className="io-readout">
      <div className="io-readout__num display" aria-label={`${value} ${label}`}>
        <span className="io-readout__lead">{padded.slice(0, lead)}</span>
        {padded.slice(lead)}
      </div>
      <div className="io-readout__label label">{label}</div>
    </div>
  )
}
