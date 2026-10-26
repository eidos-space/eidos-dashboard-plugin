import { test } from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { JSDOM } from "jsdom"
import { testI18n } from "../test-i18n.mjs"

test("locale changes preserve an unsaved title and reconcile language changes during mount", async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const names = ["window", "document", "HTMLElement", "HTMLInputElement", "Option"]
  for (const name of names) globalThis[name] = dom.window[name]
  const built = await build({ entryPoints: [new URL("../src/main.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", loader: { ".css": "empty" } })
  const { default: mount } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"))
  const i18n = testI18n("en")
  let edits = 0
  const controller = new dom.window.AbortController()
  const root = document.querySelector("#root")
  let mounted
  try {
    mounted = await mount({
      i18n, signal: controller.signal, binding: { kind: "file", file: { path: "main.dashboard" } }, subscriptions: { add() {} },
      capabilities: {
        document: {
          observe: async () => {
            i18n.setLocale("zh-CN")
            return { snapshot: { text: JSON.stringify({ kind: "eidos-dashboard", version: 1, title: "My dashboard", columns: 12, panels: [] }), version: "1", dirty: false }, subscription: { dispose() {} } }
          },
          edit: async () => { edits++ },
        },
        ui: { resources: { mount: async () => { throw Error("Locale updates must not mount resources") } } },
      },
    }, root)
    assert.equal(root.querySelector("#add").textContent, "添加面板")
    const title = root.querySelector(".title")
    title.value = "Unsaved 用户标题"
    i18n.setLocale("en")
    assert.equal(root.querySelector("#add").textContent, "Add panel")
    assert.equal(title.value, "Unsaved 用户标题")
    assert.equal(edits, 0)
    mounted.dispose()
    i18n.setLocale("zh-CN")
    assert.equal(root.innerHTML, "")
  } finally {
    controller.abort(); mounted?.dispose(); dom.window.close()
    for (const name of names) delete globalThis[name]
  }
})
