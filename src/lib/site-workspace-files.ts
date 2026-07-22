import fs from "node:fs/promises"
import path from "node:path"

const MAX_FILE_BYTES = 2 * 1024 * 1024

export type WorkspaceFileNode = {
  name: string
  path: string
  type: "file" | "directory"
  children?: WorkspaceFileNode[]
}

export function getMonacoLanguage(filePath: string) {
  const ext = path.extname(filePath).slice(1).toLowerCase()

  switch (ext) {
    case "astro":
      return "html"
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "jsx":
      return "javascript"
    case "ts":
    case "tsx":
      return "typescript"
    case "json":
      return "json"
    case "css":
      return "css"
    case "scss":
      return "scss"
    case "md":
    case "mdx":
      return "markdown"
    case "html":
    case "htm":
      return "html"
    case "yaml":
    case "yml":
      return "yaml"
    case "svg":
    case "xml":
      return "xml"
    default:
      return "plaintext"
  }
}

export function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid file path")
  }

  const root = path.resolve(workspaceRoot)
  const absolute = path.resolve(root, normalized)

  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid file path")
  }

  return { relative: normalized, absolute }
}

async function readDirectoryTree(dirPath: string, relativeDir = ""): Promise<WorkspaceFileNode[]> {
  let entries

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: WorkspaceFileNode[] = []

  for (const entry of entries) {
    const entryRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const children = await readDirectoryTree(path.join(dirPath, entry.name), entryRelative)
      nodes.push({
        name: entry.name,
        path: entryRelative,
        type: "directory",
        children,
      })
      continue
    }

    if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: entryRelative,
        type: "file",
      })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })
}

export async function listSiteWorkspaceFiles(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot)

  try {
    await fs.access(root)
  } catch {
    throw new Error("Site workspace not found")
  }

  const tree = await readDirectoryTree(root)
  return { tree }
}

export async function readSiteWorkspaceFile(workspaceRoot: string, relativePath: string) {
  const { relative, absolute } = resolveWorkspaceFilePath(workspaceRoot, relativePath)
  const stat = await fs.stat(absolute)

  if (!stat.isFile()) {
    throw new Error("Path is not a file")
  }

  if (stat.size > MAX_FILE_BYTES) {
    throw new Error("File is too large to edit in the browser")
  }

  const content = await fs.readFile(absolute, "utf8")

  return {
    path: relative,
    content,
    language: getMonacoLanguage(relative),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  }
}

export async function writeSiteWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
) {
  const { relative, absolute } = resolveWorkspaceFilePath(workspaceRoot, relativePath)
  const stat = await fs.stat(absolute)

  if (!stat.isFile()) {
    throw new Error("Path is not a file")
  }

  await fs.writeFile(absolute, content, "utf8")
  const nextStat = await fs.stat(absolute)

  return {
    path: relative,
    language: getMonacoLanguage(relative),
    size: nextStat.size,
    updatedAt: nextStat.mtime.toISOString(),
  }
}

export async function createSiteWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content = "",
) {
  const { relative, absolute } = resolveWorkspaceFilePath(workspaceRoot, relativePath)

  try {
    const existing = await fs.stat(absolute)
    if (existing.isFile()) {
      throw new Error("File already exists")
    }
    throw new Error("Path already exists")
  } catch (error) {
    if (error instanceof Error && (error.message === "File already exists" || error.message === "Path already exists")) {
      throw error
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null
    if (code !== "ENOENT") {
      throw error instanceof Error ? error : new Error("Failed to access path")
    }
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content, "utf8")
  const stat = await fs.stat(absolute)

  return {
    path: relative,
    language: getMonacoLanguage(relative),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  }
}

export async function deleteSiteWorkspaceFile(workspaceRoot: string, relativePath: string) {
  const { relative, absolute } = resolveWorkspaceFilePath(workspaceRoot, relativePath)
  const stat = await fs.stat(absolute)

  if (!stat.isFile()) {
    throw new Error("Path is not a file")
  }

  await fs.unlink(absolute)

  return {
    path: relative,
    deleted: true as const,
  }
}
