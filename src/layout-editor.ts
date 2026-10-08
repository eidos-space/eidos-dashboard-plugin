import { arrange, type Panel } from "./schema.ts"

export function movedPanels(
  panels: Panel[],
  id: string,
  target: number
): Panel[] {
  const draft = structuredClone(panels)
  const from = draft.findIndex((panel) => panel.id === id)
  if (from < 0) return draft
  draft.splice(
    Math.max(0, Math.min(draft.length - 1, target)),
    0,
    draft.splice(from, 1)[0]!
  )
  arrange(draft)
  return draft
}

export function resizedPanels(
  panels: Panel[],
  id: string,
  dx: number,
  dy: number,
  column: number,
  row: number,
  edge: string
): Panel[] {
  const draft = structuredClone(panels)
  const panel = draft.find((item) => item.id === id)
  if (!panel) return draft
  if (edge.includes("e"))
    panel.layout.w = Math.max(
      3,
      Math.min(12 - panel.layout.x, panel.layout.w + Math.round(dx / column))
    )
  if (edge.includes("s"))
    panel.layout.h = Math.max(
      2,
      Math.min(12, panel.layout.h + Math.round(dy / row))
    )
  arrange(draft)
  return draft
}

/** Preview changes geometry only; the caller commits once after pointer release. */
export function attachLayoutGesture(options: {
  handle: HTMLElement
  panelId: string
  edge?: "e" | "s" | "se"
  grid: HTMLElement
  canvas: HTMLElement
  enabled(): boolean
  panels(): Panel[]
  preview(panels: Panel[], active: string | null): void
  commit(panels: Panel[]): void
  feedback?(message: string): void
  signal: AbortSignal
}) {
  const { handle, grid, canvas, panelId, edge, signal } = options
  handle.addEventListener(
    "pointerdown",
    (start) => {
      if (start.button !== 0 || !options.enabled()) return
      options.feedback?.("Adjusting layout…")
      start.preventDefault()
      handle.focus({ preventScroll: true })
      // The handle moves during preview. Keep capture on the stationary canvas.
      const capture = canvas
      const original = structuredClone(options.panels())
      const bounds = grid.getBoundingClientRect()
      const initialScroll = canvas.scrollTop
      // Scrolling that reveals a resized card must not become more resize input.
      let revealScroll = 0
      const targets = original.map((p) => {
        const el = Array.from(grid.children).find(
          (child) => (child as HTMLElement).dataset.panelId === p.id
        ) as HTMLElement
        return el.getBoundingClientRect()
      })
      const column = (bounds.width + 12) / 12
      let draft = original,
        moved = false,
        ended = false
      let pointerX = start.clientX,
        pointerY = start.clientY
      let frame = 0
      const update = () => {
        frame = 0
        if (ended) return
        const viewport = canvas.getBoundingClientRect()
        // Resizing must not drive its own scrolling and keep growing at rest.
        const inside =
          pointerX >= viewport.left &&
          pointerX <= viewport.right &&
          pointerY >= viewport.top &&
          pointerY <= viewport.bottom
        const speed =
          !edge && moved && inside
            ? pointerY > viewport.bottom - 36
              ? Math.ceil((8 * (pointerY - viewport.bottom + 36)) / 36)
              : pointerY < viewport.top + 36
                ? -Math.ceil((8 * (viewport.top + 36 - pointerY)) / 36)
                : 0
            : 0
        const beforeScroll = canvas.scrollTop
        if (speed)
          canvas.scrollTop = Math.max(
            0,
            Math.min(
              canvas.scrollHeight - canvas.clientHeight,
              canvas.scrollTop + speed
            )
          )
        const dx =
          Math.max(bounds.left, Math.min(bounds.right, pointerX)) -
          start.clientX
        const dy =
          pointerY -
          start.clientY +
          canvas.scrollTop -
          initialScroll -
          revealScroll
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
        if (!moved) return
        if (edge) {
          draft = resizedPanels(
            original,
            panelId,
            dx,
            dy,
            column,
            80,
            matchMedia("(max-width: 700px)").matches ? "s" : edge
          )
        } else {
          const y = pointerY + canvas.scrollTop - initialScroll
          let nearest = 0,
            distance = Infinity
          targets.forEach((r, index) => {
            const xDistance = Math.max(r.left - pointerX, 0, pointerX - r.right)
            const yDistance = Math.max(r.top - y, 0, y - r.bottom)
            const score = xDistance * xDistance + yDistance * yDistance
            if (score < distance) {
              distance = score
              nearest = index
            }
          })
          draft = movedPanels(original, panelId, nearest)
        }
        options.preview(draft, panelId)
        if (
          edge &&
          (edge.includes("s") || matchMedia("(max-width: 700px)").matches)
        ) {
          const card = Array.from(grid.children).find(
            (child) => (child as HTMLElement).dataset.panelId === panelId
          ) as HTMLElement | undefined
          const bottom = card?.getBoundingClientRect().bottom
          if (bottom !== undefined && bottom > viewport.bottom - 24) {
            const before = canvas.scrollTop
            canvas.scrollTop = Math.min(
              canvas.scrollHeight - canvas.clientHeight,
              before + bottom - viewport.bottom + 24
            )
            revealScroll += canvas.scrollTop - before
          }
        }
        options.feedback?.(
          edge
            ? `Size: ${draft.find((p) => p.id === panelId)!.layout.w} × ${draft.find((p) => p.id === panelId)!.layout.h}`
            : `Position ${draft.findIndex((p) => p.id === panelId) + 1}`
        )
        if (speed && canvas.scrollTop !== beforeScroll)
          frame = requestAnimationFrame(update)
      }
      const move = (event: PointerEvent) => {
        if (event.pointerId !== start.pointerId) return
        pointerX = event.clientX
        pointerY = event.clientY
        if (!frame) frame = requestAnimationFrame(update)
      }
      const finish = (commit: boolean) => {
        if (ended) return
        ended = true
        cancelAnimationFrame(frame)
        window.removeEventListener("pointermove", move, true)
        window.removeEventListener("pointerup", up, true)
        window.removeEventListener("pointercancel", cancel, true)
        capture.removeEventListener("lostpointercapture", cancel)
        window.removeEventListener("keydown", key)
        window.removeEventListener("blur", cancel)
        canvas.removeEventListener("scroll", scroll)
        signal.removeEventListener("abort", cancel)
        if (capture.hasPointerCapture(start.pointerId))
          capture.releasePointerCapture(start.pointerId)
        const unchanged =
          JSON.stringify(options.panels()) === JSON.stringify(original)
        options.feedback?.(
          !commit
            ? "Layout cancelled"
            : moved
              ? "Layout updated"
              : "Layout unchanged"
        )
        options.preview(
          commit && moved && unchanged ? draft : options.panels(),
          null
        )
        if (!commit) canvas.scrollTop = initialScroll
        if (
          commit &&
          moved &&
          unchanged &&
          JSON.stringify(draft) !== JSON.stringify(original)
        )
          options.commit(draft)
      }
      const up = (event: PointerEvent) => {
        if (event.pointerId !== start.pointerId) return
        pointerX = event.clientX
        pointerY = event.clientY
        cancelAnimationFrame(frame)
        update()
        finish(true)
      }
      const cancel = () => finish(false)
      const scroll = () => {
        if (!ended && !frame) frame = requestAnimationFrame(update)
      }
      const key = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault()
          finish(false)
        }
      }
      capture.setPointerCapture(start.pointerId)
      window.addEventListener("pointermove", move, true)
      window.addEventListener("pointerup", up, true)
      window.addEventListener("pointercancel", cancel, true)
      capture.addEventListener("lostpointercapture", cancel)
      window.addEventListener("keydown", key)
      window.addEventListener("blur", cancel)
      canvas.addEventListener("scroll", scroll)
      signal.addEventListener("abort", cancel, { once: true })
    },
    { signal }
  )
}
