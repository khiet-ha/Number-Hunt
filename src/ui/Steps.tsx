import { useT } from "./i18n"

/** Horizontal step indicator; `current` is the 0-based active step. */
export function Steps({
  labels,
  current,
}: {
  labels: string[]
  current: number
}) {
  const t = useT()
  return (
    <ol
      class="steps-bar"
      aria-label={t("steps.label", {
        current: String(current + 1),
        total: String(labels.length),
      })}
    >
      {labels.map((label, i) => (
        <li
          key={label}
          class={i < current ? "done" : i === current ? "active" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          <span class="step-dot">{i < current ? "✓" : i + 1}</span>
          <span class="label">{label}</span>
        </li>
      ))}
    </ol>
  )
}
