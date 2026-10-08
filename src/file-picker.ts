export function matchingFiles(paths: string[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return paths
    .filter((path) =>
      words.every((word) => path.toLocaleLowerCase().includes(word))
    )
    .sort((a, b) => a.localeCompare(b))
}

export interface FileRow {
  path: string
  name: string
  depth: number
  directory: boolean
}
export function fileTree(
  paths: string[],
  expanded: Set<string>,
  query: string
): FileRow[] {
  const nodes = new Map<string, FileRow>()
  for (const path of matchingFiles(paths, query)) {
    const parts = path.split("/")
    parts.forEach((name, depth) => {
      const key = parts.slice(0, depth + 1).join("/")
      nodes.set(key, {
        path: key,
        name,
        depth,
        directory: depth < parts.length - 1,
      })
    })
  }
  const children = new Map<string, FileRow[]>()
  for (const node of nodes.values()) {
    const parent = node.path.includes("/")
      ? node.path.slice(0, node.path.lastIndexOf("/"))
      : ""
    const siblings = children.get(parent) ?? []
    siblings.push(node)
    children.set(parent, siblings)
  }
  const rows: FileRow[] = []
  const visit = (parent: string) => {
    const siblings = children.get(parent) ?? []
    siblings.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name)
    )
    for (const node of siblings) {
      rows.push(node)
      if (node.directory && (query.trim() || expanded.has(node.path)))
        visit(node.path)
    }
  }
  visit("")
  return rows
}
