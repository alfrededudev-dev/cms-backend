import path from "node:path"
import { fileURLToPath } from "node:url"
import { variantSlugToFileName } from "./slug.js"

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function resolveWorkspacesDir(workspacesDir: string) {
  return path.isAbsolute(workspacesDir) ? workspacesDir : path.resolve(backendRoot, workspacesDir)
}

export function getSiteWorkspacePath(workspacesDir: string, siteId: number) {
  return path.join(resolveWorkspacesDir(workspacesDir), `site-${siteId}`)
}

export function resolveSiteWorkspacePath(
  workspacesDir: string,
  siteId: number,
  storedPath?: string | null,
) {
  const canonical = path.normalize(getSiteWorkspacePath(workspacesDir, siteId))

  if (!storedPath?.trim()) {
    return canonical
  }

  const stored = path.isAbsolute(storedPath.trim())
    ? path.normalize(storedPath.trim())
    : path.normalize(path.resolve(resolveWorkspacesDir(workspacesDir), storedPath.trim()))

  return stored === canonical ? stored : canonical
}

export function resolveComponentPreviewDir(componentPreviewDir: string) {
  return path.isAbsolute(componentPreviewDir)
    ? componentPreviewDir
    : path.resolve(backendRoot, componentPreviewDir)
}

export function resolveAstroStarterDir(astroStarterDir: string) {
  return path.isAbsolute(astroStarterDir)
    ? astroStarterDir
    : path.resolve(backendRoot, astroStarterDir)
}

export function resolveComponentPreviewAssetsDir(componentPreviewAssetsDir: string) {
  return path.isAbsolute(componentPreviewAssetsDir)
    ? componentPreviewAssetsDir
    : path.resolve(backendRoot, componentPreviewAssetsDir)
}

export function getComponentBlocksDir(componentPreviewDir: string) {
  return path.join(resolveComponentPreviewDir(componentPreviewDir), "src", "components", "blocks")
}

export function getComponentDir(componentPreviewDir: string, componentSlug: string) {
  return path.join(getComponentBlocksDir(componentPreviewDir), componentSlug)
}

export function getVariantFilePath(componentPreviewDir: string, componentSlug: string, variantSlug: string) {
  return path.join(getComponentDir(componentPreviewDir, componentSlug), variantSlugToFileName(variantSlug))
}

export function getPreviewJsonPath(componentPreviewDir: string, componentSlug: string) {
  return path.join(getComponentDir(componentPreviewDir, componentSlug), "preview.json")
}

export function getComponentDevUrl(host: string, port: number) {
  return `http://${host}:${port}`
}

