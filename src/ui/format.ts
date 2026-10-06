/** m:ss for a countdown; never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** "3 minutes ago" in the given language ("just now" under ~45 s). */
export function formatAgo(ms: number, lng: string): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  let value: number
  let unit: Intl.RelativeTimeFormatUnit
  if (seconds < 45) {
    value = 0
    unit = "second"
  } else if (seconds < 3600) {
    value = -Math.max(1, Math.round(seconds / 60))
    unit = "minute"
  } else if (seconds < 86_400) {
    value = -Math.round(seconds / 3600)
    unit = "hour"
  } else {
    value = -Math.round(seconds / 86_400)
    unit = "day"
  }
  try {
    return new Intl.RelativeTimeFormat(lng, { numeric: "auto" }).format(
      value,
      unit
    )
  } catch {
    return `${Math.round(seconds / 60)} min`
  }
}
