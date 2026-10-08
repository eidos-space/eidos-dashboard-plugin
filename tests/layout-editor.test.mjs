import { test } from "node:test"
import assert from "node:assert/strict"
import {
  movedPanels,
  resizedPanels,
  attachLayoutGesture,
} from "../src/layout-editor.ts"

const panels = ["a", "b", "c"].map((id, i) => ({
  id,
  source: { kind: "file", path: `${id}.md` },
  layout: { x: (i % 2) * 6, y: i > 1 ? 4 : 0, w: 6, h: 4 },
}))
test("reorder previews reflow without mutating saved panels", () => {
  const next = movedPanels(panels, "a", 2)
  assert.deepEqual(
    next.map((p) => p.id),
    ["b", "c", "a"]
  )
  assert.deepEqual(
    next.map((p) => [p.layout.x, p.layout.y]),
    [
      [0, 0],
      [6, 0],
      [0, 4],
    ]
  )
  assert.equal(panels[0].id, "a")
})
test("resize snaps to grid, clamps bounds and reflows neighbours", () => {
  const next = resizedPanels(panels, "a", 200, 80, 100, 80, "se")
  assert.deepEqual(next[0].layout, { x: 0, y: 0, w: 8, h: 5 })
  assert.equal(next[1].layout.y, 5)
  assert.equal(
    resizedPanels(panels, "a", -5000, 5000, 100, 80, "se")[0].layout.w,
    3
  )
  assert.equal(
    resizedPanels(panels, "a", -5000, 5000, 100, 80, "se")[0].layout.h,
    12
  )
  assert.equal(panels[0].layout.w, 6)
  const right = resizedPanels(panels, "b", 900, 0, 100, 80, "e")
  assert.equal(right[1].layout.w, 6)
  assert.equal(right[1].layout.y, 0)
})
test("pointer moves preview; release commits once, Escape cancels", () => {
  const previous = {
    window: globalThis.window,
    matchMedia: globalThis.matchMedia,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  const pending = new Map()
  let seq = 0
  Object.assign(globalThis, {
    window: new EventTarget(),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (f) => {
      pending.set(++seq, f)
      return seq
    },
    cancelAnimationFrame: (id) => pending.delete(id),
  })
  try {
    class Handle extends EventTarget {
      capture = false
      focus() {}
      setPointerCapture() {
        this.capture = true
      }
      hasPointerCapture() {
        return this.capture
      }
      releasePointerCapture() {
        this.capture = false
      }
    }
    const handle = new Handle(),
      canvas = new Handle(),
      previews = [],
      commits = [],
      abort = new AbortController()
    const rect = { left: 0, right: 1200, top: 0, bottom: 1000, width: 1188 }
    Object.assign(canvas, {
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 1000,
      getBoundingClientRect: () => rect,
    })
    attachLayoutGesture({
      handle,
      panelId: "a",
      edge: "se",
      grid: {
        getBoundingClientRect: () => rect,
        children: panels.map((p) => ({
          dataset: { panelId: p.id },
          getBoundingClientRect: () => rect,
        })),
      },
      canvas,
      enabled: () => true,
      panels: () => panels,
      preview: (p) => previews.push(p),
      commit: (p) => commits.push(p),
      signal: abort.signal,
    })
    const send = (type, x, y) => {
      const e = new Event(type)
      Object.assign(e, { button: 0, pointerId: 1, clientX: x, clientY: y })
      ;(type === "pointerdown" ? handle : window).dispatchEvent(e)
    }
    send("pointerdown", 100, 100)
    send("pointermove", 300, 180)
    for (const [id, f] of pending) {
      pending.delete(id)
      f()
    }
    assert.equal(commits.length, 0)
    assert.equal(previews.at(-1)[0].layout.w, 8)
    send("pointerup", 300, 180)
    assert.equal(commits.length, 1)
    send("pointerdown", 100, 100)
    send("pointermove", 500, 200)
    const escape = new Event("keydown")
    Object.assign(escape, { key: "Escape" })
    window.dispatchEvent(escape)
    send("pointerup", 500, 200)
    assert.equal(commits.length, 1)
    assert.deepEqual(previews.at(-1), panels)
    abort.abort()
  } finally {
    Object.assign(globalThis, previous)
  }
})

test("bottom card can grow beyond the viewport without scroll feedback; wheel scroll continues the drag", () => {
  const previous = Object.fromEntries(
    [
      "window",
      "matchMedia",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ].map((k) => [k, globalThis[k]])
  )
  const pending = new Map()
  let seq = 0
  Object.assign(globalThis, {
    window: new EventTarget(),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (f) => {
      pending.set(++seq, f)
      return seq
    },
    cancelAnimationFrame: (id) => pending.delete(id),
  })
  try {
    class Handle extends EventTarget {
      focus() {}
      setPointerCapture() {}
      hasPointerCapture() {
        return false
      }
    }
    const handle = new Handle(),
      canvas = new Handle(),
      commits = []
    const original = [structuredClone(panels[0])]
    let preview = original
    let scrollTop = 0
    const viewport = { left: 0, right: 1200, top: 0, bottom: 600, width: 1188 }
    Object.assign(canvas, {
      clientHeight: 600,
      getBoundingClientRect: () => viewport,
    })
    Object.defineProperties(canvas, {
      scrollHeight: { get: () => 180 + preview[0].layout.h * 80 + 160 },
      scrollTop: {
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Math.max(0, Math.min(canvas.scrollHeight - 600, value))
          canvas.dispatchEvent(new Event("scroll"))
        },
      },
    })
    attachLayoutGesture({
      handle,
      canvas,
      panelId: "a",
      edge: "s",
      grid: {
        getBoundingClientRect: () => viewport,
        children: [
          {
            dataset: { panelId: "a" },
            getBoundingClientRect: () => ({
              ...viewport,
              bottom: 180 + preview[0].layout.h * 80 - scrollTop,
            }),
          },
        ],
      },
      enabled: () => true,
      panels: () => original,
      preview: (value) => {
        preview = value
      },
      commit: (value) => commits.push(value),
      signal: new AbortController().signal,
    })
    const send = (type, y) => {
      const e = new Event(type)
      Object.assign(e, { button: 0, pointerId: 1, clientX: 300, clientY: y })
      ;(type === "pointerdown" ? handle : window).dispatchEvent(e)
    }
    const flush = () => {
      let frames = 0
      while (pending.size) {
        assert.ok(++frames < 10, "must settle without an endless scroll loop")
        for (const [id, f] of [...pending]) {
          pending.delete(id)
          f()
        }
      }
    }
    send("pointerdown", 496)
    send("pointermove", 596)
    flush()
    assert.equal(preview[0].layout.h, 5)
    assert.equal(scrollTop, 4)
    assert.equal(pending.size, 0)
    canvas.scrollTop += 80
    flush()
    assert.equal(preview[0].layout.h, 6)
    send("pointerup", 596)
    assert.equal(commits.length, 1)
    assert.equal(commits[0][0].layout.h, 6)
    assert.equal(original[0].layout.h, 4)
  } finally {
    Object.assign(globalThis, previous)
  }
})
