import fs from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import type { Db } from "./index.js"
import { sites, type ThemeColorToken } from "./schema.js"
import { getSiteById } from "./sites.js"
import type { Env } from "../env.js"
import { resolveSiteWorkspacePath } from "../lib/paths.js"
import { notifySiteDevServerWorkspaceUpdated } from "../lib/site-dev-server.js"
import {
  buildSiteThemeCss,
  buildSiteThemePayload,
  getThemeColorsFromRecord,
  normalizeThemeColors,
} from "../lib/site-theme-sync.js"

const THEME_IMPORT = '@import "../cms/theme.css";'
const THEME_MARKER = "cms/theme.css"
const THEME_JSON_MARKER = "cms/theme.json"
const THEME_LAYOUT_IMPORT = `import siteTheme from "../cms/theme.json";`

export function mapSiteThemeResponse(site: { themeColors: ThemeColorToken[] | null | undefined }) {
  const colors = getThemeColorsFromRecord(site)
  return buildSiteThemePayload(colors)
}

export async function getSiteTheme(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  return mapSiteThemeResponse(site)
}

async function ensureDirectory(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function ensureGlobalCssThemeImport(globalCssPath: string) {
  let content = await fs.readFile(globalCssPath, "utf8")

  if (content.includes(THEME_MARKER)) {
    return
  }

  if (content.includes('@import "tailwindcss"')) {
    content = content.replace('@import "tailwindcss";', `@import "tailwindcss";\n${THEME_IMPORT}`)
  } else {
    content = `${THEME_IMPORT}\n${content}`
  }

  await fs.writeFile(globalCssPath, content, "utf8")
}

async function ensureLayoutThemeHooks(layoutPath: string) {
  let content = await fs.readFile(layoutPath, "utf8")

  if (!content.includes(THEME_JSON_MARKER)) {
    const frontmatterEnd = content.indexOf("---", 3)
    if (frontmatterEnd === -1) {
      throw new Error("Layout.astro is missing frontmatter")
    }

    content = `${content.slice(0, frontmatterEnd)}\n${THEME_LAYOUT_IMPORT}\n${content.slice(frontmatterEnd)}`
  }

  if (!content.includes("siteTheme.headStylesHtml")) {
    content = content.replace(
      "<title>{pageTitle}</title>",
      `<title>{pageTitle}</title>\n\t\t{siteTheme.headStylesHtml ? <Fragment set:html={siteTheme.headStylesHtml} /> : null}`,
    )
  }

  await fs.writeFile(layoutPath, content, "utf8")
}

export async function syncSiteThemeToWorkspace(
  workspacesDir: string,
  siteId: number,
  workspacePath: string | null | undefined,
  colors: ThemeColorToken[],
) {
  const absoluteWorkspacePath = resolveSiteWorkspacePath(workspacesDir, siteId, workspacePath)
  const cmsDir = path.join(absoluteWorkspacePath, "src", "cms")
  const themeCssPath = path.join(cmsDir, "theme.css")
  const themeJsonPath = path.join(cmsDir, "theme.json")
  const globalCssPath = path.join(absoluteWorkspacePath, "src", "styles", "global.css")
  const layoutPath = path.join(absoluteWorkspacePath, "src", "layouts", "Layout.astro")
  const payload = buildSiteThemePayload(colors)

  await ensureDirectory(cmsDir)

  await fs.writeFile(themeCssPath, buildSiteThemeCss(colors), "utf8")
  await fs.writeFile(
    themeJsonPath,
    `${JSON.stringify(
      {
        colors: payload.colors,
        headStylesHtml: payload.headStylesHtml,
        tailwindClasses: payload.tailwindClasses,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  try {
    await fs.access(globalCssPath)
    await ensureGlobalCssThemeImport(globalCssPath)
  } catch {
    // styles may not exist yet
  }

  try {
    await fs.access(layoutPath)
    await ensureLayoutThemeHooks(layoutPath)
  } catch {
    // layout may not exist yet
  }

  return {
    workspacePath: absoluteWorkspacePath,
    themeCssPath,
    themeJsonPath,
  }
}

export async function ensureSiteThemeInWorkspace(db: Db, env: Env, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site?.workspacePath || site.cloneStatus !== "ready") {
    return
  }

  await syncSiteThemeToWorkspace(
    env.WORKSPACES_DIR,
    siteId,
    site.workspacePath,
    getThemeColorsFromRecord(site),
  )
}

export async function saveSiteTheme(db: Db, env: Env, siteId: number, colors: ThemeColorToken[]) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  const normalizedColors = normalizeThemeColors(colors)

  const [updatedSite] = await db
    .update(sites)
    .set({
      themeColors: normalizedColors,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!updatedSite) {
    throw new Error("Failed to save site theme")
  }

  if (updatedSite.cloneStatus === "ready") {
    await syncSiteThemeToWorkspace(env.WORKSPACES_DIR, siteId, updatedSite.workspacePath, normalizedColors)

    notifySiteDevServerWorkspaceUpdated(siteId)
  }

  return mapSiteThemeResponse(updatedSite)
}
