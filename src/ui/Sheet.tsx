import type { ComponentChildren } from "preact"
import { useLayoutEffect, useRef } from "preact/hooks"

import { useT } from "./i18n"

/**
 * Modal bottom sheet that pushes up from the bottom edge.
 *
 * It keeps the user where they are: the page behind is dimmed and locked, so
 * nothing needs scrolling to reach the task, and closing returns to exactly
 * the same place. Esc, the ✕ button and a tap on the dimmed area all close it.
 */
export function Sheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
  testId?: string
}) {
  const t = useT()
  const closeBtn = useRef<HTMLButtonElement>(null)
  // Latest handler without re-running the lock effect on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Layout effect: the lock must be released in the same commit that removes
  // the sheet, not after the next paint, or the page stays frozen for a beat.
  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current()
    }
    addEventListener("keydown", onKey)
    return () => {
      removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [])

  return (
    <div class="sheet-backdrop" data-testid={testId} onClick={onClose}>
      <section
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="sheet-grabber" aria-hidden="true" />
        <header class="sheet-head">
          <h3>{title}</h3>
          <button
            ref={closeBtn}
            class="icon"
            data-testid="sheet-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  )
}
