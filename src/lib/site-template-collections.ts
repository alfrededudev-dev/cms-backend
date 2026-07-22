import { and, eq } from "drizzle-orm"
import type { Db } from "../db/index.js"
import { siteCollections } from "../db/schema.js"
import type { DataFieldDefinition } from "./data-model.js"
import { isHomeSlug } from "./site-routing.js"
import { DEFAULT_COLLECTION_ENTRY_MODEL } from "./collection-entry-data.js"

export type SiteTemplatePageType = "static" | "collection"

export async function syncTemplateCollections(
  db: Db,
  siteId: number,
  pages: Array<{
    slug: string
    name: string
    pageType: SiteTemplatePageType
  }>,
  timestamp: string,
) {
  const collectionPages = pages.filter((page) => page.pageType === "collection" && !isHomeSlug(page.slug))

  for (const page of collectionPages) {
    const [existing] = await db
      .select()
      .from(siteCollections)
      .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.slug, page.slug)))

    if (!existing) {
      await db.insert(siteCollections).values({
        siteId,
        slug: page.slug,
        name: page.name,
        description: null,
        fieldsSchema: DEFAULT_COLLECTION_ENTRY_MODEL,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      continue
    }

    await db
      .update(siteCollections)
      .set({
        name: page.name,
        updatedAt: timestamp,
      })
      .where(eq(siteCollections.id, existing.id))
  }
}

export function getCollectionSlugsFromTemplatePages(
  pages: Array<{ slug: string; pageType: SiteTemplatePageType }>,
) {
  return pages
    .filter((page) => page.pageType === "collection" && !isHomeSlug(page.slug))
    .map((page) => page.slug)
}
