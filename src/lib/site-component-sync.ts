import fs from "node:fs/promises"
import path from "node:path"
import type { Env } from "../env.js"
import { getComponentBlocksDir, getComponentDir, getSiteWorkspacePath, resolveAstroStarterDir } from "./paths.js"

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function syncSharedComponentsToSite(
  env: Env,
  siteId: number,
) {
  const starterDir = resolveAstroStarterDir(env.ASTRO_STARTER_DIR)
  const siteRoot = getSiteWorkspacePath(env.WORKSPACES_DIR, siteId)
  const sharedFiles = [
    "FormField.astro",
    "CmsRichText.astro",
    "CmsNestedZone.astro",
    "CmsForm.astro",
    "CmsFormShell.astro",
    "CmsFormField.astro",
    "cms-form-schema.ts",
    "cms-form.js",
  ]

  for (const fileName of sharedFiles) {
    const sourcePath = path.join(starterDir, "src", "components", fileName)
    const targetPath = path.join(siteRoot, "src", "components", fileName)

    if (!(await pathExists(sourcePath))) {
      continue
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
  }

  const globalCssSource = path.join(starterDir, "src", "styles", "global.css")
  const globalCssTarget = path.join(siteRoot, "src", "styles", "global.css")

  if (await pathExists(globalCssSource)) {
    await fs.mkdir(path.dirname(globalCssTarget), { recursive: true })
    await fs.copyFile(globalCssSource, globalCssTarget)
  }
}

export async function syncComponentToSite(
  componentPreviewDir: string,
  workspacesDir: string,
  siteId: number,
  componentSlug: string,
) {
  const sourceDir = getComponentDir(componentPreviewDir, componentSlug)
  const targetDir = path.join(getSiteWorkspacePath(workspacesDir, siteId), "src", "components", "blocks", componentSlug)

  await fs.mkdir(path.dirname(targetDir), { recursive: true })
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true })
}

export async function syncComponentsToSite(
  componentPreviewDir: string,
  workspacesDir: string,
  siteId: number,
  componentSlugs: string[],
) {
  const uniqueSlugs = [...new Set(componentSlugs)]

  for (const slug of uniqueSlugs) {
    await syncComponentToSite(componentPreviewDir, workspacesDir, siteId, slug)
  }
}

export function getSiteBlocksDir(workspacesDir: string, siteId: number) {
  return path.join(getSiteWorkspacePath(workspacesDir, siteId), "src", "components", "blocks")
}

export function getPreviewBlocksDir(componentPreviewDir: string) {
  return getComponentBlocksDir(componentPreviewDir)
}
