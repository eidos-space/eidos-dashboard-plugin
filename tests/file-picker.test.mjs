import { test } from "node:test"
import assert from "node:assert/strict"
import { matchingFiles, fileTree } from "../src/file-picker.ts"
test("tree includes all formats and expands directories, search reveals ancestors", () => {
  const paths = [
    "data/Report.EIDOS",
    "assets/a.png",
    "notes.md",
    ".agents/info.eidos",
    "data/.cache/x.eidos",
    "trips/walk.gpx",
  ]
  assert.equal(matchingFiles(paths, "").length, paths.length)
  assert.deepEqual(
    fileTree(paths, new Set(), "").map((r) => r.path),
    [".agents", "assets", "data", "trips", "notes.md"]
  )
  assert.ok(
    fileTree(paths, new Set(["trips"]), "").some(
      (r) => r.path === "trips/walk.gpx"
    )
  )
  assert.deepEqual(
    fileTree(paths, new Set(), "walk").map((r) => r.path),
    ["trips", "trips/walk.gpx"]
  )
})
test("search matches path and name before limiting displayed results", () => {
  const paths = Array.from(
    { length: 1500 },
    (_, n) => `archive/report-${n}.eidos`
  )
  assert.deepEqual(matchingFiles(paths, "ARCHIVE 1499"), [
    "archive/report-1499.eidos",
  ])
  assert.deepEqual(matchingFiles(paths, "missing"), [])
})
