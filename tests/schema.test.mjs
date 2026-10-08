import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDashboard, stringifyDashboard, arrange, relativeReference } from "../src/schema.ts"
const panel = { id: "one", source: { kind: "file", path: "../notes.md" }, layout: { x: 0, y: 0, w: 6, h: 4 } }
const dashboard = { kind: "eidos-dashboard", version: 1, title: "Demo", columns: 12, panels: [panel] }
test("round-trips configuration and preserves extension properties", () => {
  const d = { ...dashboard, extra: { color: "blue" } }
  assert.deepEqual(parseDashboard(stringifyDashboard(d, "\r\n")), d)
})
test("rejects malformed layout, versions, duplicate IDs and URLs", () => {
  for (const value of [{ ...dashboard, version: 2 }, { ...dashboard, panels: [panel, panel] }, { ...dashboard, panels: [{ ...panel, layout: { ...panel.layout, w: 13 } }] }, { ...dashboard, panels: [{ ...panel, source: { kind: "file", path: "https://example.com" } }] }]) assert.throws(() => parseDashboard(JSON.stringify(value)))
})
test("packs resized cards without overlap", () => {
  const panels = [structuredClone(panel), { ...structuredClone(panel), id: "two" }, { ...structuredClone(panel), id: "three" }]
  panels[0].layout.w = 8; arrange(panels)
  assert.deepEqual(panels.map(p => [p.layout.x,p.layout.y]), [[0,0],[0,4],[6,4]])
})
test("portable references resolve from nested dashboards", () => {
  assert.equal(relativeReference("reports/main.dashboard", "data/file.eidos"), "../data/file.eidos")
  assert.equal(relativeReference("reports/main.dashboard", "reports/notes.md"), "notes.md")
})
