import { and, eq } from "drizzle-orm"
import type { Env } from "../env.js"
import type { Db } from "../db/index.js"
import { sitePages } from "../db/schema.js"
import { syncSiteWorkspaceRouting } from "./site-routing-sync.js"
import { isHomeSlug } from "./site-routing.js"
import { ensureDefaultSiteTemplate } from "../db/site-template.js"

export async function getCollectionTemplateSlugs(db: Db, siteId: number) {
  const pages = await db
    .select({ slug: sitePages.slug })
    .from(sitePages)
    .where(and(eq(sitePages.siteId, siteId), eq(sitePages.pageType, "collection")))

  return new Set(pages.map((page) => page.slug))
}

export async function hasCollectionTemplatePage(db: Db, siteId: number, slug: string) {
  const slugs = await getCollectionTemplateSlugs(db, siteId)
  return slugs.has(slug)
}

export async function ensureCollectionTemplatePage(
  db: Db,
  env: Env,
  siteId: number,
  input: { slug: string; name: string },
) {
  if (isHomeSlug(input.slug)) {
    throw new Error("Home page cannot be a collection template")
  }

  await ensureDefaultSiteTemplate(db, siteId)

  const [existingCollection] = await db
    .select()
    .from(sitePages)
    .where(
      and(
        eq(sitePages.siteId, siteId),
        eq(sitePages.slug, input.slug),
        eq(sitePages.pageType, "collection"),
      ),
    )

  const timestamp = new Date().toISOString()

  if (existingCollection) {
    if (existingCollection.name !== input.name) {
      await db
        .update(sitePages)
        .set({
          name: input.name,
          updatedAt: timestamp,
        })
        .where(eq(sitePages.id, existingCollection.id))
    }

    await syncSiteWorkspaceRouting(db, env, siteId)
    return existingCollection
  }

  const pages = await db.select().from(sitePages).where(eq(sitePages.siteId, siteId))
  const nextSortOrder = pages.reduce((max, page) => Math.max(max, page.sortOrder), -1) + 1

  const [page] = await db
    .insert(sitePages)
    .values({
      siteId,
      slug: input.slug,
      name: input.name,
      pageType: "collection",
      sortOrder: nextSortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!page) {
    throw new Error("Failed to create collection template page")
  }

  await syncSiteWorkspaceRouting(db, env, siteId)
  return page
}

export async function syncCollectionTemplatePageName(
  db: Db,
  env: Env,
  siteId: number,
  input: { slug: string; name: string },
) {
  const [existing] = await db
    .select()
    .from(sitePages)
    .where(
      and(eq(sitePages.siteId, siteId), eq(sitePages.slug, input.slug), eq(sitePages.pageType, "collection")),
    )

  if (!existing || existing.name === input.name) {
    return
  }

  await db
    .update(sitePages)
    .set({
      name: input.name,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sitePages.id, existing.id))

  await syncSiteWorkspaceRouting(db, env, siteId)
}

export async function removeCollectionTemplatePage(db: Db, env: Env, siteId: number, slug: string) {
  const deleted = await db
    .delete(sitePages)
    .where(
      and(eq(sitePages.siteId, siteId), eq(sitePages.slug, slug), eq(sitePages.pageType, "collection")),
    )
    .returning()

  if (deleted.length > 0) {
    await syncSiteWorkspaceRouting(db, env, siteId)
  }
}

export async function hasSingleTemplatePage(db: Db, siteId: number, slug: string) {
  const [page] = await db
    .select({ slug: sitePages.slug })
    .from(sitePages)
    .where(
      and(eq(sitePages.siteId, siteId), eq(sitePages.slug, slug), eq(sitePages.pageType, "static")),
    )

  return Boolean(page)
}

export async function ensureSingleTemplatePage(
  db: Db,
  env: Env,
  siteId: number,
  input: { slug: string; name: string },
) {
  if (isHomeSlug(input.slug)) {
    throw new Error("Home page cannot be a single type page")
  }

  await ensureDefaultSiteTemplate(db, siteId)

  const [existingStatic] = await db
    .select()
    .from(sitePages)
    .where(
      and(
        eq(sitePages.siteId, siteId),
        eq(sitePages.slug, input.slug),
        eq(sitePages.pageType, "static"),
      ),
    )

  const timestamp = new Date().toISOString()

  if (existingStatic) {
    if (existingStatic.name !== input.name) {
      await db
        .update(sitePages)
        .set({
          name: input.name,
          updatedAt: timestamp,
        })
        .where(eq(sitePages.id, existingStatic.id))
    }

    await syncSiteWorkspaceRouting(db, env, siteId)
    return existingStatic
  }

  const pages = await db.select().from(sitePages).where(eq(sitePages.siteId, siteId))
  const nextSortOrder = pages.reduce((max, page) => Math.max(max, page.sortOrder), -1) + 1

  const [page] = await db
    .insert(sitePages)
    .values({
      siteId,
      slug: input.slug,
      name: input.name,
      pageType: "static",
      sortOrder: nextSortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!page) {
    throw new Error("Failed to create single type template page")
  }

  await syncSiteWorkspaceRouting(db, env, siteId)
  return page
}

export async function syncSingleTemplatePageName(
  db: Db,
  env: Env,
  siteId: number,
  input: { slug: string; name: string },
) {
  const [existing] = await db
    .select()
    .from(sitePages)
    .where(
      and(eq(sitePages.siteId, siteId), eq(sitePages.slug, input.slug), eq(sitePages.pageType, "static")),
    )

  if (!existing || existing.name === input.name) {
    return
  }

  await db
    .update(sitePages)
    .set({
      name: input.name,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sitePages.id, existing.id))

  await syncSiteWorkspaceRouting(db, env, siteId)
}

export async function removeSingleTemplatePage(db: Db, env: Env, siteId: number, slug: string) {
  const deleted = await db
    .delete(sitePages)
    .where(
      and(eq(sitePages.siteId, siteId), eq(sitePages.slug, slug), eq(sitePages.pageType, "static")),
    )
    .returning()

  if (deleted.length > 0) {
    await syncSiteWorkspaceRouting(db, env, siteId)
  }
}
