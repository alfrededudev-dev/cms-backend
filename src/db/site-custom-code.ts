import { eq } from "drizzle-orm"
import type { Db } from "./index.js"
import { sites } from "./schema.js"
import { getSiteById } from "./sites.js"
import type { Env } from "../env.js"
import {
  buildCustomCodePayload,
  getSiteCustomCodeFromRecord,
  syncSiteCustomCodeToWorkspace,
  type SiteCustomCodeInput,
} from "../lib/site-custom-code-sync.js"
import { notifySiteDevServerWorkspaceUpdated } from "../lib/site-dev-server.js"

export function mapSiteCustomCodeResponse(site: {
  customHeadStyles: string
  customHeadLinks: string
  customHeadScripts: string
  customBodyScripts: string
}) {
  const customCode = getSiteCustomCodeFromRecord(site)
  const payload = buildCustomCodePayload(customCode)

  return {
    ...customCode,
    preview: {
      headLinksHtml: payload.headLinksHtml,
      headStylesHtml: payload.headStylesHtml,
      headScriptsHtml: payload.headScriptsHtml,
      bodyScriptsHtml: payload.bodyScriptsHtml,
    },
  }
}

export async function getSiteCustomCode(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  return mapSiteCustomCodeResponse(site)
}

export async function ensureSiteCustomCodeInWorkspace(db: Db, env: Env, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site?.workspacePath || site.cloneStatus !== "ready") {
    return
  }

  await syncSiteCustomCodeToWorkspace(
    env.WORKSPACES_DIR,
    siteId,
    site.workspacePath,
    getSiteCustomCodeFromRecord(site),
  )
}

export async function saveSiteCustomCode(db: Db, env: Env, siteId: number, input: SiteCustomCodeInput) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  const [updatedSite] = await db
    .update(sites)
    .set({
      customHeadStyles: input.headStyles,
      customHeadLinks: input.headLinks,
      customHeadScripts: input.headScripts,
      customBodyScripts: input.bodyScripts,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!updatedSite) {
    throw new Error("Failed to save custom code")
  }

  if (updatedSite.cloneStatus === "ready") {
    await syncSiteCustomCodeToWorkspace(env.WORKSPACES_DIR, siteId, updatedSite.workspacePath, input)

    notifySiteDevServerWorkspaceUpdated(siteId)
  }

  return mapSiteCustomCodeResponse(updatedSite)
}
