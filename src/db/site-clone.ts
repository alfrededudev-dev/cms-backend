import { asc, eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import type { Env } from "../env.js"
import { cloneGitRepository } from "../lib/git.js"
import { getSiteWorkspacePath, resolveWorkspacesDir } from "../lib/paths.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import type { Db } from "./index.js"
import {
  siteCollectionEntries,
  siteCollections,
  siteForms,
  siteLayoutBlocks,
  siteLayouts,
  sitePageBlocks,
  sitePages,
  sites,
  type Site,
} from "./schema.js"
import { ensureDefaultSiteLayout } from "./site-layout.js"
import { getAppSettings } from "./settings.js"
import { getSiteById } from "./sites.js"

function resolveStoredWorkspacePath(env: Env, workspacePath: string) {
  return path.isAbsolute(workspacePath)
    ? workspacePath
    : path.resolve(resolveWorkspacesDir(env.WORKSPACES_DIR), workspacePath)
}

async function copySiteMediaFiles(env: Env, source: Site, targetSiteId: number) {
  if (!source.workspacePath?.trim()) {
    return
  }

  const sourceMediaDir = path.join(resolveStoredWorkspacePath(env, source.workspacePath), "public", "media")
  const targetMediaDir = path.join(getSiteWorkspacePath(env.WORKSPACES_DIR, targetSiteId), "public", "media")

  try {
    await fs.access(sourceMediaDir)
  } catch {
    return
  }

  await fs.mkdir(targetMediaDir, { recursive: true })
  await fs.cp(sourceMediaDir, targetMediaDir, { recursive: true, force: true })
}

async function copySiteDatabaseContent(
  db: Db,
  sourceSiteId: number,
  targetSiteId: number,
  timestamp: string,
) {
  const sourceLayouts = await db
    .select()
    .from(siteLayouts)
    .where(eq(siteLayouts.siteId, sourceSiteId))
    .orderBy(asc(siteLayouts.sortOrder), asc(siteLayouts.id))

  const layoutIdMap = new Map<number, number>()

  if (sourceLayouts.length === 0) {
    await ensureDefaultSiteLayout(db, targetSiteId)
  }

  for (const layout of sourceLayouts) {
    const [newLayout] = await db
      .insert(siteLayouts)
      .values({
        siteId: targetSiteId,
        name: layout.name,
        slug: layout.slug,
        isDefault: layout.isDefault,
        sortOrder: layout.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()

    if (!newLayout) {
      throw new Error("Failed to copy site layout")
    }

    layoutIdMap.set(layout.id, newLayout.id)
  }

  const sourcePages = await db
    .select()
    .from(sitePages)
    .where(eq(sitePages.siteId, sourceSiteId))
    .orderBy(asc(sitePages.sortOrder), asc(sitePages.id))

  const pageIdMap = new Map<number, number>()

  for (const page of sourcePages) {
    const [newPage] = await db
      .insert(sitePages)
      .values({
        siteId: targetSiteId,
        slug: page.slug,
        name: page.name,
        pageType: page.pageType,
        layoutId: page.layoutId ? layoutIdMap.get(page.layoutId) ?? null : null,
        fieldsSchema: page.fieldsSchema,
        fieldValues: page.fieldValues,
        sortOrder: page.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()

    if (!newPage) {
      throw new Error("Failed to copy site page")
    }

    pageIdMap.set(page.id, newPage.id)
  }

  for (const page of sourcePages) {
    const newPageId = pageIdMap.get(page.id)
    if (!newPageId) {
      continue
    }

    const blocks = await db
      .select()
      .from(sitePageBlocks)
      .where(eq(sitePageBlocks.pageId, page.id))
      .orderBy(asc(sitePageBlocks.sortOrder), asc(sitePageBlocks.id))

    for (const block of blocks) {
      await db.insert(sitePageBlocks).values({
        pageId: newPageId,
        componentId: block.componentId,
        variantSlug: block.variantSlug,
        props: block.props,
        themeColorMap: block.themeColorMap,
        collectionEntryLoop: block.collectionEntryLoop,
        sortOrder: block.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }

  for (const layout of sourceLayouts) {
    const targetLayoutId = layoutIdMap.get(layout.id)
    if (!targetLayoutId) {
      continue
    }

    const layoutBlocks = await db
      .select()
      .from(siteLayoutBlocks)
      .where(eq(siteLayoutBlocks.layoutId, layout.id))
      .orderBy(asc(siteLayoutBlocks.sortOrder), asc(siteLayoutBlocks.id))

    for (const block of layoutBlocks) {
      await db.insert(siteLayoutBlocks).values({
        layoutId: targetLayoutId,
        componentId: block.componentId,
        variantSlug: block.variantSlug,
        props: block.props,
        themeColorMap: block.themeColorMap,
        sortOrder: block.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }

  const sourceCollections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, sourceSiteId))
    .orderBy(asc(siteCollections.id))

  const collectionIdMap = new Map<number, number>()

  for (const collection of sourceCollections) {
    const [newCollection] = await db
      .insert(siteCollections)
      .values({
        siteId: targetSiteId,
        slug: collection.slug,
        name: collection.name,
        description: collection.description,
        kind: collection.kind,
        fieldsSchema: collection.fieldsSchema,
        singleData: collection.singleData,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()

    if (!newCollection) {
      throw new Error("Failed to copy site collection")
    }

    collectionIdMap.set(collection.id, newCollection.id)
  }

  for (const collection of sourceCollections) {
    const newCollectionId = collectionIdMap.get(collection.id)
    if (!newCollectionId) {
      continue
    }

    const entries = await db
      .select()
      .from(siteCollectionEntries)
      .where(eq(siteCollectionEntries.collectionId, collection.id))
      .orderBy(asc(siteCollectionEntries.id))

    for (const entry of entries) {
      await db.insert(siteCollectionEntries).values({
        collectionId: newCollectionId,
        slug: entry.slug,
        title: entry.title,
        excerpt: entry.excerpt,
        body: entry.body,
        data: entry.data,
        status: entry.status,
        publishedAt: entry.publishedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }

  const sourceForms = await db
    .select()
    .from(siteForms)
    .where(eq(siteForms.siteId, sourceSiteId))
    .orderBy(asc(siteForms.id))

  for (const form of sourceForms) {
    await db.insert(siteForms).values({
      siteId: targetSiteId,
      slug: form.slug,
      name: form.name,
      description: form.description,
      fieldsSchema: form.fieldsSchema,
      settings: form.settings,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
}

export async function cloneSite(
  db: Db,
  env: Env,
  sourceSiteId: number,
  input: {
    name: string
    domain: string
  },
) {
  const source = await getSiteById(db, sourceSiteId)

  if (!source) {
    throw new Error("Site not found")
  }

  if (source.cloneStatus !== "ready" || !source.workspacePath) {
    throw new Error("Source site workspace is not ready")
  }

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
      description: source.description,
      status: source.status,
      siteHealth: "offline",
      formsStatus: source.formsStatus,
      cloneStatus: "pending",
      gitRemoteUrl: null,
      gitBranch: "main",
      ftpHost: null,
      ftpPort: 21,
      ftpUsername: null,
      ftpPassword: null,
      ftpRemotePath: null,
      ftpSecure: false,
      sshHost: null,
      sshPort: 22,
      sshUsername: null,
      sshPassword: null,
      sshRemotePath: null,
      customHeadStyles: source.customHeadStyles,
      customHeadLinks: source.customHeadLinks,
      customHeadScripts: source.customHeadScripts,
      customBodyScripts: source.customBodyScripts,
      themeColors: source.themeColors,
      smtpHost: source.smtpHost,
      smtpPort: source.smtpPort,
      smtpUser: source.smtpUser,
      smtpPassword: source.smtpPassword,
      smtpFrom: source.smtpFrom,
      smtpSecure: source.smtpSecure,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!site) {
    throw new Error("Failed to create cloned site")
  }

  const workspacePath = getSiteWorkspacePath(env.WORKSPACES_DIR, site.id)

  try {
    await cloneGitRepository({
      gitUrl: settings.starterGitUrl,
      branch: settings.starterGitBranch,
      targetPath: workspacePath,
    })

    await copySiteDatabaseContent(db, sourceSiteId, site.id, timestamp)
    await copySiteMediaFiles(env, source, site.id)

    await db
      .update(sites)
      .set({
        workspacePath,
        cloneStatus: "ready",
        cloneError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sites.id, site.id))

    await syncSiteWorkspaceRouting(db, env, site.id)

    const [updatedSite] = await db.select().from(sites).where(eq(sites.id, site.id))
    return updatedSite ?? site
  } catch (error) {
    const cloneError = error instanceof Error ? error.message : "Site clone failed"

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
