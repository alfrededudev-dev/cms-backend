import { desc, eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import type { Db } from "./index.js"
import { sites, type Site } from "./schema.js"
import { getAppSettings } from "./settings.js"
import { cloneGitRepository } from "../lib/git.js"
import { getSiteWorkspacePath, resolveWorkspacesDir } from "../lib/paths.js"
import { purgeSiteDevState } from "../lib/site-dev-server.js"
import { purgeSiteBuildPreview } from "../lib/site-build-preview-server.js"
import type { Env } from "../env.js"
import { initializeSiteTemplate } from "./site-template.js"

export function mapSiteResponse(site: Site) {
  return {
    id: String(site.id),
    name: site.name,
    domain: site.domain,
    description: site.description ?? "",
    status: site.status,
    siteHealth: site.siteHealth,
    formsStatus: site.formsStatus,
    workspacePath: site.workspacePath,
    cloneStatus: site.cloneStatus,
    cloneError: site.cloneError,
    gitRemoteUrl: site.gitRemoteUrl ?? null,
    gitBranch: site.gitBranch ?? "main",
    ftpHost: site.ftpHost ?? null,
    ftpPort: site.ftpPort ?? 21,
    ftpUsername: site.ftpUsername ?? null,
    ftpRemotePath: site.ftpRemotePath ?? null,
    ftpSecure: site.ftpSecure ?? false,
    hasFtpPassword: Boolean(site.ftpPassword),
    sshHost: site.sshHost ?? null,
    sshPort: site.sshPort ?? 22,
    sshUsername: site.sshUsername ?? null,
    sshRemotePath: site.sshRemotePath ?? null,
    hasSshPassword: Boolean(site.sshPassword),
    smtpHost: site.smtpHost ?? null,
    smtpPort: site.smtpPort ?? 587,
    smtpUser: site.smtpUser ?? null,
    smtpFrom: site.smtpFrom ?? null,
    smtpSecure: site.smtpSecure ?? false,
    hasSmtpPassword: Boolean(site.smtpPassword),
    lastUpdated: site.updatedAt,
    createdAt: site.createdAt,
  }
}

export async function listSites(db: Db) {
  return db.select().from(sites).orderBy(desc(sites.updatedAt))
}

export async function getSiteById(db: Db, siteId: number) {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
  return site
}

export async function createSite(
  db: Db,
  env: Env,
  input: {
    name: string
    domain: string
    description?: string
  },
) {
  const settings = await getAppSettings(db)

  if (!settings.starterGitUrl) {
    throw new Error("Starter git URL is not configured in Settings")
  }

  const timestamp = new Date().toISOString()

  const [site] = await db
    .insert(sites)
    .values({
      name: input.name,
      domain: input.domain,
      description: input.description ?? null,
      status: "draft",
      siteHealth: "offline",
      formsStatus: "no_forms",
      cloneStatus: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!site) {
    throw new Error("Failed to create site")
  }

  const workspacePath = getSiteWorkspacePath(env.WORKSPACES_DIR, site.id)

  try {
    await cloneGitRepository({
      gitUrl: settings.starterGitUrl,
      branch: settings.starterGitBranch,
      targetPath: workspacePath,
    })

    const [updatedSite] = await db
      .update(sites)
      .set({
        workspacePath,
        cloneStatus: "ready",
        cloneError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sites.id, site.id))
      .returning()

    await initializeSiteTemplate(db, site.id)

    return updatedSite ?? site
  } catch (error) {
    const cloneError = error instanceof Error ? error.message : "Git clone failed"

    const [failedSite] = await db
      .update(sites)
      .set({
        workspacePath,
        cloneStatus: "failed",
        cloneError,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sites.id, site.id))
      .returning()

    return failedSite ?? site
  }
}

export async function updateSite(
  db: Db,
  siteId: number,
  input: {
    name?: string
    domain?: string
    description?: string
    status?: Site["status"]
    siteHealth?: Site["siteHealth"]
    formsStatus?: Site["formsStatus"]
  },
) {
  const existing = await getSiteById(db, siteId)

  if (!existing) {
    throw new Error("Site not found")
  }

  const [site] = await db
    .update(sites)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.siteHealth !== undefined ? { siteHealth: input.siteHealth } : {}),
      ...(input.formsStatus !== undefined ? { formsStatus: input.formsStatus } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!site) {
    throw new Error("Failed to update site")
  }

  return site
}

export async function updateSiteGitConfig(
  db: Db,
  siteId: number,
  input: {
    gitRemoteUrl?: string | null
    gitBranch?: string
  },
) {
  const existing = await getSiteById(db, siteId)

  if (!existing) {
    throw new Error("Site not found")
  }

  const [site] = await db
    .update(sites)
    .set({
      ...(input.gitRemoteUrl !== undefined ? { gitRemoteUrl: input.gitRemoteUrl } : {}),
      ...(input.gitBranch !== undefined ? { gitBranch: input.gitBranch } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!site) {
    throw new Error("Failed to update site git config")
  }

  return site
}

export async function updateSiteFtpConfig(
  db: Db,
  siteId: number,
  input: {
    ftpHost?: string | null
    ftpPort?: number
    ftpUsername?: string | null
    ftpPassword?: string | null
    ftpRemotePath?: string | null
    ftpSecure?: boolean
  },
) {
  const existing = await getSiteById(db, siteId)

  if (!existing) {
    throw new Error("Site not found")
  }

  const [site] = await db
    .update(sites)
    .set({
      ...(input.ftpHost !== undefined ? { ftpHost: input.ftpHost || null } : {}),
      ...(input.ftpPort !== undefined ? { ftpPort: input.ftpPort } : {}),
      ...(input.ftpUsername !== undefined ? { ftpUsername: input.ftpUsername || null } : {}),
      ...(input.ftpPassword !== undefined ? { ftpPassword: input.ftpPassword || null } : {}),
      ...(input.ftpRemotePath !== undefined ? { ftpRemotePath: input.ftpRemotePath || null } : {}),
      ...(input.ftpSecure !== undefined ? { ftpSecure: input.ftpSecure } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!site) {
    throw new Error("Failed to update site FTP config")
  }

  return site
}

export async function updateSiteSshConfig(
  db: Db,
  siteId: number,
  input: {
    sshHost?: string | null
    sshPort?: number
    sshUsername?: string | null
    sshPassword?: string | null
    sshRemotePath?: string | null
  },
) {
  const existing = await getSiteById(db, siteId)

  if (!existing) {
    throw new Error("Site not found")
  }

  const [site] = await db
    .update(sites)
    .set({
      ...(input.sshHost !== undefined ? { sshHost: input.sshHost || null } : {}),
      ...(input.sshPort !== undefined ? { sshPort: input.sshPort } : {}),
      ...(input.sshUsername !== undefined ? { sshUsername: input.sshUsername || null } : {}),
      ...(input.sshPassword !== undefined ? { sshPassword: input.sshPassword || null } : {}),
      ...(input.sshRemotePath !== undefined ? { sshRemotePath: input.sshRemotePath || null } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sites.id, siteId))
    .returning()

  if (!site) {
    throw new Error("Failed to update site SSH config")
  }

  return site
}

function resolveStoredWorkspacePath(env: Env, workspacePath: string) {
  return path.isAbsolute(workspacePath)
    ? workspacePath
    : path.resolve(resolveWorkspacesDir(env.WORKSPACES_DIR), workspacePath)
}

async function removeSiteWorkspace(env: Env, site: Site) {
  const paths = new Set<string>([getSiteWorkspacePath(env.WORKSPACES_DIR, site.id)])

  if (site.workspacePath?.trim()) {
    paths.add(resolveStoredWorkspacePath(env, site.workspacePath.trim()))
  }

  for (const workspacePath of paths) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true })
    } catch {
      // directory may already be missing or locked; DB row is still removed
    }
  }
}

export async function deleteSite(db: Db, env: Env, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    return false
  }

  await purgeSiteDevState(siteId)
  await purgeSiteBuildPreview(siteId)

  if (process.platform === "win32") {
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  await removeSiteWorkspace(env, site)

  // CASCADE removes site_pages, site_page_blocks, site_collections, site_collection_entries, site_page_seo
  await db.delete(sites).where(eq(sites.id, siteId))

  return true
}
