import type { ResourceSource } from "@eidos.space/plugin-sdk"
export interface Panel {
  id: string
  title?: string
  source: ResourceSource
  layout: { x: number; y: number; w: number; h: number }
}
export interface Dashboard {
  kind: "eidos-dashboard"
  version: 1
  title: string
  columns: 12
  panels: Panel[]
}
export function parseDashboard(text: string): Dashboard {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== "object")
    throw Error("Expected a dashboard object")
  const d = value as Dashboard
  if (
    d.kind !== "eidos-dashboard" ||
    d.version !== 1 ||
    d.columns !== 12 ||
    typeof d.title !== "string" ||
    d.title.length > 200 ||
    !Array.isArray(d.panels) ||
    d.panels.length > 12
  )
    throw Error(
      "Expected dashboard version 1, 12 columns and at most 12 panels"
    )
  const ids = new Set<string>()
  for (const p of d.panels) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
      ids.has(p.id)
    )
      throw Error("Panel IDs must be unique")
    ids.add(p.id)
    if (
      p.title !== undefined &&
      (typeof p.title !== "string" || p.title.length > 200)
    )
      throw Error("Invalid panel title")
    const s = p.source
    if (
      !s ||
      typeof s.path !== "string" ||
      !s.path ||
      s.path.length > 2048 ||
      /[\\:\u0000-\u001f]/.test(s.path) ||
      s.path.startsWith("/") ||
      !["file", "eidos-view"].includes(s.kind)
    )
      throw Error("Expected a relative file reference")
    if (
      s.kind === "file" &&
      s.editor !== undefined &&
      (typeof s.editor !== "string" || !s.editor || s.editor.length > 256)
    )
      throw Error("Invalid file view")
    if (
      s.kind === "eidos-view" &&
      (!s.tableId ||
        typeof s.tableId !== "string" ||
        !s.viewId ||
        typeof s.viewId !== "string")
    )
      throw Error("Choose a table and saved view")
    const l = p.layout
    if (
      !l ||
      ![l.x, l.y, l.w, l.h].every(Number.isInteger) ||
      l.x < 0 ||
      l.y < 0 ||
      l.y > 1000 ||
      l.w < 3 ||
      l.x + l.w > 12 ||
      l.h < 2 ||
      l.h > 12
    )
      throw Error("Invalid panel layout")
  }
  return d
}
export function stringifyDashboard(value: Dashboard, newline = "\n"): string {
  return (JSON.stringify(value, null, 2) + "\n").replaceAll("\n", newline)
}
export function arrange(panels: Panel[]): void {
  let x = 0,
    y = 0,
    height = 0
  for (const panel of panels) {
    if (x + panel.layout.w > 12) {
      y += height
      x = 0
      height = 0
    }
    panel.layout.x = x
    panel.layout.y = y
    x += panel.layout.w
    height = Math.max(height, panel.layout.h)
  }
}
export function relativeReference(baseFile: string, target: string): string {
  const from = baseFile.split("/").slice(0, -1),
    to = target.split("/")
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  return [...from.map(() => ".."), ...to].join("/")
}
