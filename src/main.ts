import type {
  ViewContext,
  TextSnapshot,
  ResourceMount,
  ResourceViewInfo,
} from "@eidos.space/plugin-sdk"
import {
  parseDashboard,
  stringifyDashboard,
  arrange,
  relativeReference,
  type Dashboard,
  type Panel,
} from "./schema"
import "./style.css"
import { fileTree } from "./file-picker"
import { attachLayoutGesture, movedPanels } from "./layout-editor"

export default async function mount(ctx: ViewContext, root: HTMLElement) {
  const file = ctx.capabilities.document,
    resources = ctx.capabilities.ui.resources
  if (!file || ctx.binding.kind !== "file")
    throw Error("Dashboard requires a configuration file")
  if (!resources) throw Error("Dashboard requires Eidos Lite plugin API 3.2")
  if (!ctx.binding.file.path)
    throw Error("Dashboard requires a local file path")
  const basePath = ctx.binding.file.path!
  root.innerHTML = `<header class="toolbar"><input class="title" aria-label="Dashboard title"><button id="add">Add panel</button><button id="save">Save</button><button id="undo">Undo</button><button id="redo">Redo</button><span role="status" aria-live="polite"></span></header><form class="add-panel" hidden><label>File<select id="file"><option value="">Choose a file…</option></select></label><label id="view-label" hidden>Saved view<select id="view"></select></label><button type="submit">Add</button><button id="cancel" type="button">Cancel</button><p class="hint">Choose a saved chart or table view, a text file, or an image.</p></form><main class="canvas"><div class="grid"></div><p class="empty">Add a saved view or file to build your dashboard.</p></main><textarea class="recovery" aria-label="Unsaved configuration to recover" hidden readonly></textarea>`
  const $ = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!
  const grid = $(".grid"),
    status = $("[role=status]"),
    title = $<HTMLInputElement>(".title")
  const form = $<HTMLFormElement>("form"),
    fileSelect = $<HTMLSelectElement>("#file"),
    viewSelect = $<HTMLSelectElement>("#view")
  const pickerTools = document.createElement("div")
  pickerTools.className = "picker-tools"
  pickerTools.innerHTML = `<input type="search" aria-label="Search files" placeholder="Search files…">`
  form.prepend(pickerTools)
  const fileQuery = pickerTools.querySelector("input")!
  const pickerHint = $(".hint")
  form.popover = "auto"
  form.setAttribute("aria-label", "Add panel")
  const results = document.createElement("div")
  results.className = "picker-results"
  results.setAttribute("role", "tree")
  results.setAttribute("aria-label", "Files")
  pickerTools.after(results)
  const footer = document.createElement("footer")
  footer.className = "picker-footer"
  footer.append(
    pickerHint,
    $("#cancel"),
    form.querySelector('button[type="submit"]')!
  )
  form.append(footer)
  fileSelect.parentElement!.hidden = true
  fileSelect.size = 5
  fileSelect.parentElement!.classList.add("file-results")
  let filePaths: string[] = []
  const expanded = new Set<string>()
  const renderFiles = () => {
    const matches = fileTree(filePaths, expanded, fileQuery.value)
    const selected = fileSelect.value
    fileSelect.replaceChildren(
      ...filePaths.map(
        (path) => new Option(path, relativeReference(basePath, path))
      )
    )
    fileSelect.value = selected
    results.replaceChildren(
      ...matches.map((entry) => {
        const row = document.createElement("button")
        row.type = "button"
        row.setAttribute("role", "treeitem")
        row.setAttribute("aria-level", String(entry.depth + 1))
        row.setAttribute(
          "aria-selected",
          String(
            !entry.directory &&
              relativeReference(basePath, entry.path) === selected
          )
        )
        if (entry.directory)
          row.setAttribute(
            "aria-expanded",
            String(!!fileQuery.value.trim() || expanded.has(entry.path))
          )
        row.title = entry.path
        row.dataset.path = entry.path
        row.style.paddingLeft = `${8 + entry.depth * 16}px`
        const icon = document.createElement("span"),
          name = document.createElement("span")
        icon.className = "tree-icon"
        icon.setAttribute("aria-hidden", "true")
        icon.textContent = entry.directory
          ? row.getAttribute("aria-expanded") === "true"
            ? "⌄"
            : "›"
          : "▫"
        name.textContent = entry.name
        row.append(icon, name)
        row.onclick = () => {
          if (entry.directory) {
            if (expanded.has(entry.path)) expanded.delete(entry.path)
            else expanded.add(entry.path)
            renderFiles()
            Array.from(results.querySelectorAll<HTMLButtonElement>("button"))
              .find((item) => item.dataset.path === entry.path)
              ?.focus()
            return
          }
          results
            .querySelectorAll("button")
            .forEach((item) =>
              item.setAttribute("aria-selected", String(item === row))
            )
          fileSelect.value = relativeReference(basePath, entry.path)
          fileSelect.dispatchEvent(new Event("change"))
        }
        return row
      })
    )
    pickerHint.textContent = matches.length ? "" : "No matching files"
  }
  fileQuery.oninput = renderFiles
  type Card = {
    element: HTMLElement
    body: HTMLElement
    source: string
    handle?: ResourceMount
    pending: boolean
  }
  const cards = new Map<string, Card>()
  const dismissMenus = () =>
    root
      .querySelectorAll<HTMLElement>(".panel-actions:popover-open")
      .forEach((menu) => menu.hidePopover())
  window.addEventListener("blur", dismissMenus, { signal: ctx.signal })
  $(".canvas").addEventListener("scroll", dismissMenus, { signal: ctx.signal })
  let snapshot: TextSnapshot,
    model: Dashboard,
    queued = 0,
    conflict = false,
    editing = false,
    chain = Promise.resolve()
  let views: ResourceViewInfo[] = [],
    lookupGeneration = 0
  const report = (cause: unknown) => {
    status.textContent = cause instanceof Error ? cause.message : String(cause)
  }
  const button = (label: string, action: () => void, description = label) => {
    const el = document.createElement("button")
    el.type = "button"
    el.textContent = label
    el.title = description
    el.setAttribute("aria-label", description)
    el.onclick = action
    return el
  }
  const editLayout = button("Edit layout", () => {
    editing = !editing
    root.classList.toggle("editing", editing)
    editLayout.textContent = editing ? "Done" : "Edit layout"
    editLayout.setAttribute("aria-pressed", String(editing))
    render()
  })
  editLayout.className = "edit-layout"
  $(".toolbar").insertBefore(editLayout, $("#save"))
  const icons = {
    undo: '<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12"/>',
    redo: '<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
  }
  for (const method of ["undo", "redo"] as const) {
    const control = $<HTMLButtonElement>(`#${method}`)
    control.className = "icon-button"
    control.setAttribute("aria-label", method === "undo" ? "Undo" : "Redo")
    control.title = method === "undo" ? "Undo" : "Redo"
    control.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[method]}</svg>`
    $(".toolbar").insertBefore(control, editLayout)
  }
  $(".toolbar").insertBefore($("#save"), editLayout)
  const persist = (mutate: (draft: Dashboard) => void) => {
    queued++
    chain = chain
      .then(async () => {
        if (conflict || ctx.signal.aborted) return
        const draft = structuredClone(model)
        mutate(draft)
        const text = stringifyDashboard(
          draft,
          snapshot.text.includes("\r\n") ? "\r\n" : "\n"
        )
        parseDashboard(text)
        const result = await file.edit({
          text,
          expectedVersion: snapshot.version,
          label: "Edit dashboard",
        })
        if (result.status === "stale") {
          conflict = true
          const recovery = $<HTMLTextAreaElement>(".recovery")
          recovery.value = text
          recovery.hidden = false
          throw Error(
            "The file changed elsewhere. Your proposed configuration is preserved below; reconcile it in the text editor."
          )
        }
        accept(result.snapshot)
      })
      .catch(report)
      .finally(() => {
        queued--
      })
  }
  function reorder(from: string, to: string) {
    persist((draft) => {
      const source = draft.panels.findIndex((p) => p.id === from),
        target = draft.panels.findIndex((p) => p.id === to)
      if (source < 0 || target < 0) return
      draft.panels.splice(target, 0, draft.panels.splice(source, 1)[0]!)
      arrange(draft.panels)
    })
  }
  function previewLayout(panels: Panel[], active: string | null = null) {
    for (const [index, panel] of panels.entries()) {
      const card = cards.get(panel.id)
      if (!card) continue
      const { x, y, w, h } = panel.layout
      card.element.style.gridColumn = `${x + 1} / span ${w}`
      card.element.style.gridRow = `${y + 1} / span ${h}`
      card.element.style.order = String(index)
      card.element.style.setProperty("--panel-height", `${h * 80 - 12}px`)
      card.element.classList.toggle("layout-preview", panel.id === active)
    }
  }
  function bindGesture(
    handle: HTMLElement,
    id: string,
    edge?: "e" | "s" | "se"
  ) {
    attachLayoutGesture({
      handle,
      panelId: id,
      edge,
      grid,
      canvas: $(".canvas"),
      enabled: () => editing && !queued && !conflict,
      panels: () => model.panels,
      preview: previewLayout,
      feedback: (message) => {
        status.textContent = message
      },
      commit: (panels) =>
        persist((draft) => {
          const order = new Map(panels.map((p, i) => [p.id, i]))
          for (const p of draft.panels) {
            const next = panels.find((item) => item.id === p.id)
            if (next) p.layout = { ...next.layout }
          }
          draft.panels.sort(
            (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)
          )
        }),
      signal: ctx.signal,
    })
  }
  async function load(panel: Panel, card: Card) {
    if (card.pending) return
    card.pending = true
    card.body.textContent = ""
    try {
      const handle = await resources!.mount(card.body, panel.source)
      if (ctx.signal.aborted || cards.get(panel.id) !== card) handle.dispose()
      else card.handle = handle
    } catch (cause) {
      if (cards.get(panel.id) === card) {
        card.body.textContent =
          cause instanceof Error ? cause.message : String(cause)
        card.body.setAttribute("role", "alert")
      }
    } finally {
      card.pending = false
    }
  }
  function render() {
    title.value = model.title
    $(".empty").hidden = model.panels.length > 0
    for (const [id, card] of cards)
      if (
        !model.panels.some(
          (p) => p.id === id && JSON.stringify(p.source) === card.source
        )
      ) {
        card.handle?.dispose()
        card.element.remove()
        cards.delete(id)
      }
    for (const panel of model.panels) {
      let card = cards.get(panel.id)
      if (!card) {
        const element = document.createElement("section"),
          head = document.createElement("header"),
          body = document.createElement("div")
        element.className = "panel"
        element.dataset.panelId = panel.id
        head.className = "panel-header"
        body.className = "panel-body"
        const handle = button(
          "⠿",
          () => {},
          "Reorder panel: Space, arrow keys, then Enter"
        )
        handle.className = "drag"
        bindGesture(handle, panel.id)
        let keyboardTarget: number | null = null
        handle.onkeydown = (event) => {
          if (event.key === " " && keyboardTarget === null) {
            event.preventDefault()
            keyboardTarget = model.panels.findIndex((p) => p.id === panel.id)
            handle.setAttribute("aria-pressed", "true")
            status.textContent =
              "Use arrows to choose a position, Enter to place, Escape to cancel"
          } else if (keyboardTarget !== null) {
            if (
              ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
                event.key
              )
            ) {
              event.preventDefault()
              keyboardTarget = Math.max(
                0,
                Math.min(
                  model.panels.length - 1,
                  keyboardTarget +
                    (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)
                )
              )
              status.textContent = `Position ${keyboardTarget + 1}`
              previewLayout(
                movedPanels(model.panels, panel.id, keyboardTarget),
                panel.id
              )
            }
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault()
              if (event.key === "Enter")
                reorder(panel.id, model.panels[keyboardTarget]!.id)
              keyboardTarget = null
              previewLayout(model.panels)
              handle.setAttribute("aria-pressed", "false")
            }
          }
        }
        const name = document.createElement("input")
        name.className = "panel-title"
        name.setAttribute("aria-label", "Panel title")
        name.onchange = () => {
          const value = name.value
          persist((d) => {
            d.panels.find((p) => p.id === panel.id)!.title = value
          })
        }
        const actions = document.createElement("div")
        actions.className = "panel-actions"
        actions.popover = "auto"
        actions.setAttribute("role", "menu")
        actions.setAttribute("aria-label", "Panel actions")
        const more = button(
          "⋯",
          () => {
            if (actions.matches(":popover-open")) {
              actions.hidePopover()
              return
            }
            const anchor = more.getBoundingClientRect()
            actions.style.left = `${Math.max(8, Math.min(innerWidth - 176, anchor.right - 168))}px`
            actions.style.top = `${Math.max(8, Math.min(innerHeight - 120, anchor.bottom + 4))}px`
            actions.showPopover()
            actions.querySelector<HTMLButtonElement>("button")?.focus()
          },
          "Panel actions"
        )
        more.className = "panel-more"
        more.setAttribute("aria-expanded", "false")
        more.setAttribute("aria-haspopup", "menu")
        actions.addEventListener("toggle", () =>
          more.setAttribute(
            "aria-expanded",
            String(actions.matches(":popover-open"))
          )
        )
        actions.onkeydown = (event) => {
          if (event.key === "Escape") {
            actions.hidePopover()
            more.focus()
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault()
            const items = Array.from(
              actions.querySelectorAll<HTMLButtonElement>("button")
            )
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement
            )
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length
            items[next]?.focus()
          }
        }
        actions.onclick = () => {
          actions.hidePopover()
          more.focus()
        }
        actions.append(
          button(
            "Open source",
            () => {
              const target = basePath.split("/").slice(0, -1)
              for (const part of panel.source.path.split("/")) {
                if (part === "..") target.pop()
                else if (part !== ".") target.push(part)
              }
              void ctx.capabilities.ui
                .openFile?.(target.join("/"))
                .catch(report)
            },
            "Open source file"
          ),
          button(
            "Refresh",
            () => {
              const c = cards.get(panel.id)
              if (!c) return
              if (c.handle) void c.handle.refresh().catch(report)
              else void load(panel, c)
            },
            "Refresh panel"
          ),
          button(
            "Remove",
            () =>
              persist((d) => {
                d.panels = d.panels.filter((p) => p.id !== panel.id)
                arrange(d.panels)
              }),
            "Remove panel"
          )
        )
        actions
          .querySelectorAll("button")
          .forEach((item) => item.setAttribute("role", "menuitem"))
        head.append(handle, name, more)
        element.append(head, actions, body)
        for (const edge of ["e", "s", "se"] as const) {
          const resize = button(
            "",
            () => {},
            "Resize panel with arrow keys or drag"
          )
          resize.className = `resize resize-${edge}`
          bindGesture(resize, panel.id, edge)
          resize.onkeydown = (event) => {
            if (!event.key.startsWith("Arrow")) return
            event.preventDefault()
            persist((draft) => {
              const target = draft.panels.find((p) => p.id === panel.id)!
              if (edge.includes("e"))
                target.layout.w = Math.max(
                  3,
                  Math.min(
                    12,
                    target.layout.w +
                      (event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0)
                  )
                )
              if (edge.includes("s"))
                target.layout.h = Math.max(
                  2,
                  Math.min(
                    12,
                    target.layout.h +
                      (event.key === "ArrowDown"
                        ? 1
                        : event.key === "ArrowUp"
                          ? -1
                          : 0)
                  )
                )
              arrange(draft.panels)
            })
          }
          element.append(resize)
        }
        card = {
          element,
          body,
          source: JSON.stringify(panel.source),
          pending: false,
        }
        cards.set(panel.id, card)
        grid.append(element)
        void load(panel, card)
      }
      card.element.querySelector<HTMLInputElement>(".panel-title")!.value =
        panel.title || panel.source.path.split("/").pop()!
      card.element.querySelector<HTMLInputElement>(".panel-title")!.readOnly =
        !editing
    }
    previewLayout(model.panels)
  }
  function accept(state: TextSnapshot) {
    const parsed = parseDashboard(state.text)
    snapshot = state
    model = parsed
    render()
    $("#save").hidden = !state.dirty && !state.conflicted
    status.textContent = state.conflicted
      ? "File changed on disk; use host recovery"
      : ""
  }
  const observed = await file.observe((state) => {
    if (!queued && !conflict) {
      try {
        accept(state)
      } catch (cause) {
        report(cause)
      }
    }
  }, report)
  ctx.subscriptions.add(observed.subscription)
  accept(observed.snapshot)
  title.onchange = () => {
    const value = title.value
    persist((d) => {
      d.title = value
    })
  }
  async function save() {
    const focused = document.activeElement
    if (
      focused instanceof HTMLInputElement &&
      (focused === title || focused.classList.contains("panel-title"))
    )
      focused.blur()
    await chain
    if (conflict) return
    const result = await file!.save()
    accept(result.snapshot)
    if (result.status === "conflict")
      report("File changed on disk. Draft retained; use host recovery.")
  }
  $("#save").onclick = () => {
    void save().catch(report)
  }
  for (const method of ["undo", "redo"] as const)
    $(`#${method}`).onclick = () => {
      chain = chain
        .then(async () => {
          if (!conflict) accept(await file[method]())
        })
        .catch(report)
    }
  root.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void save().catch(report)
      }
    },
    { signal: ctx.signal }
  )
  $("#cancel").onclick = () => {
    form.hidePopover()
    lookupGeneration++
  }
  $("#add").onclick = () => {
    if (form.matches(":popover-open")) {
      form.hidePopover()
      return
    }
    form.hidden = false
    form.style.top = `${$("#add").getBoundingClientRect().bottom + 8}px`
    form.showPopover()
    fileQuery.focus()
    void ctx.capabilities.fs
      ?.list("", { recursive: true })
      .then((files) => {
        if (ctx.signal.aborted) return
        filePaths = files.filter((f) => !f.isDirectory).map((f) => f.path)
        renderFiles()
      })
      .catch(report)
  }
  fileSelect.onchange = () => {
    addButton.disabled = true
    const generation = ++lookupGeneration
    views = []
    viewSelect.replaceChildren()
    $("#view-label").hidden = !fileSelect.value
    $("#view-label").firstChild!.textContent = "View"
    if (fileSelect.value)
      void resources
        .listViews(fileSelect.value)
        .then((items) => {
          if (generation !== lookupGeneration || ctx.signal.aborted) return
          views = items
          for (const [index, item] of items.entries())
            viewSelect.add(
              new Option(
                item.kind === "file"
                  ? item.name
                  : `${item.tableName} / ${item.name}`,
                String(index)
              )
            )
          addButton.disabled = items.length === 0
          if (!items.length) pickerHint.textContent = "No available views"
        })
        .catch(report)
  }
  const addSelected = () => {
    const path = fileSelect.value
    if (!path) return
    const view = views[Number(viewSelect.value)]
    if (addButton.disabled || !view) {
      report("Choose a view")
      return
    }
    persist((d) => {
      if (d.panels.length >= 12)
        throw Error("A dashboard supports up to 12 panels")
      d.panels.push({
        id: crypto.randomUUID(),
        title: view.kind === "file" ? path.split("/").pop() : view.name,
        source:
          view.kind !== "file"
            ? {
                kind: "eidos-view",
                path,
                tableId: view.tableId,
                viewId: view.viewId,
              }
            : { kind: "file", path, editor: view.editor },
        layout: { x: 0, y: 0, w: 6, h: 4 },
      })
      arrange(d.panels)
    })
    form.hidePopover()
  }
  const addButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  )!
  addButton.type = "button"
  addButton.disabled = true
  addButton.onclick = addSelected
  form.onkeydown = (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".picker-results button"
    )
    if (row && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault()
      const expanded = row.getAttribute("aria-expanded")
      if (
        (event.key === "ArrowRight" && expanded === "false") ||
        (event.key === "ArrowLeft" && expanded === "true")
      )
        row.click()
      else if (event.key === "ArrowLeft") {
        const parent = row.dataset.path?.split("/").slice(0, -1).join("/")
        Array.from(results.querySelectorAll<HTMLButtonElement>("button"))
          .find((item) => item.dataset.path === parent)
          ?.focus()
      }
      return
    }
    if (row && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      const rows = Array.from(
        results.querySelectorAll<HTMLButtonElement>("button")
      )
      rows[
        (rows.indexOf(row) +
          (event.key === "ArrowDown" ? 1 : -1) +
          rows.length) %
          rows.length
      ]?.focus()
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (row) {
        row.click()
        return
      }
      if (event.target === fileQuery) {
        results.querySelector<HTMLButtonElement>("button")?.focus()
        return
      }
      addSelected()
    }
  }
  return {
    dispose() {
      for (const card of cards.values()) card.handle?.dispose()
      cards.clear()
      root.replaceChildren()
    },
  }
}
