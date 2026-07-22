import { asc, desc, eq, and } from "drizzle-orm"
import type { Env } from "../env.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import {
  ensureCollectionTemplatePage,
  ensureSingleTemplatePage,
  removeCollectionTemplatePage,
  removeSingleTemplatePage,
  syncCollectionTemplatePageName,
  syncSingleTemplatePageName,
} from "../lib/site-model-sync.js"
import { DEFAULT_COLLECTION_ENTRY_MODEL } from "../lib/collection-entry-data.js"
import {
  extractLegacyEntryColumns,
  mergeEntryDataForForm,
} from "../lib/collection-entry-data.js"
import {
  fieldsSchemaSchema,
  normalizeFieldsSchema,
  validateFieldValues,
  type ContentTypeKind,
} from "../lib/data-model.js"
import { isHomeSlug } from "../lib/site-routing.js"
import { slugify } from "../lib/slug.js"
import type { Db } from "./index.js"
import { siteCollectionEntries, siteCollections, sitePages } from "./schema.js"
import { getSiteById } from "./sites.js"

async function assertCollectionSlugAvailable(db: Db, siteId: number, slug: string) {
  const [existing] = await db
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(eq(siteCollections.siteId, siteId), eq(siteCollections.slug, slug)))
    .limit(1)

  if (existing) {
    throw new Error(`Content type with slug "${slug}" already exists`)
  }
}

async function ensureUniqueCollectionSlug(db: Db, siteId: number, name: string) {
  const baseSlug = slugify(name) || "collection"
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const existing = await db
      .select()
      .from(siteCollections)
      .where(eq(siteCollections.siteId, siteId))

    if (!existing.some((item) => item.slug === slug)) {
      return slug
    }

    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

async function ensureUniqueEntrySlug(db: Db, collectionId: number, title: string) {
  const baseSlug = slugify(title) || "entry"
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const existing = await db
      .select()
      .from(siteCollectionEntries)
      .where(eq(siteCollectionEntries.collectionId, collectionId))

    if (!existing.some((item) => item.slug === slug)) {
      return slug
    }

    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

async function assertSiteWorkspaceReady(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  return site
}

export async function getCollectionsForGeneration(db: Db, siteId: number) {
  const collections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))
    .orderBy(asc(siteCollections.name))

  const result = []

  for (const collection of collections) {
    if (collection.kind === "single" || collection.kind === "global") {
      continue
    }

    const entries = await db
      .select()
      .from(siteCollectionEntries)
      .where(eq(siteCollectionEntries.collectionId, collection.id))
      .orderBy(desc(siteCollectionEntries.publishedAt), desc(siteCollectionEntries.updatedAt))

    result.push({
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      fieldsSchema: collection.fieldsSchema ?? [],
      entries: entries.map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        excerpt: entry.excerpt,
        body: entry.body,
        data: entry.data ?? {},
        status: entry.status,
        publishedAt: entry.publishedAt,
        updatedAt: entry.updatedAt,
      })),
    })
  }

  return result
}

export async function getGlobalForGeneration(db: Db, siteId: number) {
  const collections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))

  const global = collections.find((item) => item.kind === "global")

  if (!global) {
    return null
  }

  return {
    name: global.name,
    fieldsSchema: global.fieldsSchema ?? [],
    fieldValues: global.singleData ?? {},
  }
}

async function assertOnlyOneGlobalType(db: Db, siteId: number) {
  const collections = await db
    .select({ kind: siteCollections.kind })
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))

  if (collections.some((item) => item.kind === "global")) {
    throw new Error("This site already has a Global type. Only one site-wide settings model is allowed.")
  }
}

export async function getSinglesForGeneration(db: Db, siteId: number) {
  const singles = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))
    .orderBy(asc(siteCollections.name))

  return singles
    .filter((item) => item.kind === "single")
    .map((item) => ({
      slug: item.slug,
      name: item.name,
      fieldsSchema: item.fieldsSchema ?? [],
      fieldValues: item.singleData ?? {},
    }))
}

export async function getSiteCollectionRoutingMeta(db: Db, siteId: number) {
  const collections = await db
    .select({
      slug: siteCollections.slug,
    })
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))

  return {
    slugs: collections.map((collection) => collection.slug),
  }
}

async function syncCollectionsToWorkspace(db: Db, env: Env, siteId: number) {
  await assertSiteWorkspaceReady(db, siteId)
  await syncSiteWorkspaceRouting(db, env, siteId)
}

function mapEntryResponse(entry: typeof siteCollectionEntries.$inferSelect) {
  const legacy = {
    title: entry.title,
    excerpt: entry.excerpt ?? "",
    body: entry.body ?? "",
  }

  return {
    id: String(entry.id),
    slug: entry.slug,
    title: entry.title,
    excerpt: legacy.excerpt,
    body: legacy.body,
    data: mergeEntryDataForForm(entry.data ?? {}, legacy),
    status: entry.status,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function mapCollectionResponse(
  collection: typeof siteCollections.$inferSelect,
  entries: ReturnType<typeof mapEntryResponse>[],
) {
  return {
    id: String(collection.id),
    slug: collection.slug,
    name: collection.name,
    description: collection.description ?? "",
    kind: (collection.kind ?? "collection") as ContentTypeKind,
    fieldsSchema: normalizeFieldsSchema(collection.fieldsSchema ?? []),
    singleData: collection.singleData ?? {},
    entryCount: collection.kind === "single" || collection.kind === "global" ? 0 : entries.length,
    entries: collection.kind === "single" || collection.kind === "global" ? [] : entries,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }
}

function singleTypeHasContent(data: Record<string, unknown>) {
  return Object.values(data).some((value) => {
    if (value === null || value === undefined || value === "") {
      return false
    }
    if (Array.isArray(value)) {
      return value.length > 0
    }
    if (typeof value === "object") {
      return Object.keys(value as object).length > 0
    }
    return true
  })
}

export async function listSiteContentTypes(db: Db, siteId: number) {
  const collections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))
    .orderBy(asc(siteCollections.name))

  const templatePages = await db
    .select({ slug: sitePages.slug, pageType: sitePages.pageType })
    .from(sitePages)
    .where(eq(sitePages.siteId, siteId))

  const collectionTemplateSlugs = new Set(
    templatePages.filter((page) => page.pageType === "collection").map((page) => page.slug),
  )
  const staticTemplateSlugs = new Set(
    templatePages.filter((page) => page.pageType === "static").map((page) => page.slug),
  )
  const result = []

  for (const collection of collections) {
    const kind = (collection.kind ?? "collection") as ContentTypeKind
    const entries =
      kind === "single" || kind === "global"
        ? []
        : await db
            .select({ id: siteCollectionEntries.id })
            .from(siteCollectionEntries)
            .where(eq(siteCollectionEntries.collectionId, collection.id))

    result.push({
      id: String(collection.id),
      slug: collection.slug,
      name: collection.name,
      description: collection.description ?? "",
      kind,
      fieldsSchema: normalizeFieldsSchema(collection.fieldsSchema ?? []),
      entryCount: kind === "single" || kind === "global" ? 0 : entries.length,
      hasContent:
        kind === "single" || kind === "global"
          ? singleTypeHasContent(collection.singleData ?? {})
          : entries.length > 0,
      hasTemplatePage:
        kind === "global"
          ? false
          : kind === "single"
            ? staticTemplateSlugs.has(collection.slug)
            : collectionTemplateSlugs.has(collection.slug),
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    })
  }

  return { contentTypes: result }
}

export async function listSiteCollections(db: Db, siteId: number) {
  const collections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))
    .orderBy(asc(siteCollections.name))

  const result = []

  for (const collection of collections) {
    const entries = await db
      .select()
      .from(siteCollectionEntries)
      .where(eq(siteCollectionEntries.collectionId, collection.id))
      .orderBy(desc(siteCollectionEntries.updatedAt))

    result.push(mapCollectionResponse(collection, entries.map(mapEntryResponse)))
  }

  return { collections: result }
}

export async function getSiteCollection(db: Db, siteId: number, collectionId: number) {
  const [collection] = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.id, collectionId))

  if (!collection || collection.siteId !== siteId) {
    return null
  }

  const entries = await db
    .select()
    .from(siteCollectionEntries)
    .where(eq(siteCollectionEntries.collectionId, collection.id))
    .orderBy(desc(siteCollectionEntries.updatedAt))

  return mapCollectionResponse(collection, entries.map(mapEntryResponse))
}

export async function createSiteCollection(
  db: Db,
  env: Env,
  siteId: number,
  input: {
    name: string
    slug?: string
    description?: string
    kind?: ContentTypeKind
    fieldsSchema?: unknown
    createTemplatePage?: boolean
  },
) {
  await assertSiteWorkspaceReady(db, siteId)

  const kind = input.kind ?? "collection"

  if (kind === "global") {
    await assertOnlyOneGlobalType(db, siteId)
  }

  const slug = input.slug?.trim() || (await ensureUniqueCollectionSlug(db, siteId, input.name))
  const timestamp = new Date().toISOString()
  const createTemplatePage = kind === "global" ? false : (input.createTemplatePage ?? false)
  let fieldsSchema =
    input.fieldsSchema !== undefined
      ? normalizeFieldsSchema(fieldsSchemaSchema.parse(input.fieldsSchema))
      : []

  if (fieldsSchema.length === 0 && createTemplatePage && kind === "collection") {
    fieldsSchema = DEFAULT_COLLECTION_ENTRY_MODEL
  }

  if (input.slug?.trim()) {
    await assertCollectionSlugAvailable(db, siteId, slug)
  }

  if (createTemplatePage && isHomeSlug(slug)) {
    throw new Error('Slug "home" is reserved for the site index page. Choose another slug.')
  }

  let createdCollectionId: number | null = null

  try {
    const [collection] = await db
      .insert(siteCollections)
      .values({
        siteId,
        slug,
        name: input.name,
        description: input.description ?? null,
        kind,
        fieldsSchema,
        singleData: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()

    if (!collection) {
      throw new Error("Failed to create collection")
    }

    createdCollectionId = collection.id

    if (createTemplatePage && kind !== "global") {
      if (kind === "single") {
        await ensureSingleTemplatePage(db, env, siteId, {
          slug: collection.slug,
          name: collection.name,
        })
      } else {
        await ensureCollectionTemplatePage(db, env, siteId, {
          slug: collection.slug,
          name: collection.name,
        })
      }
    } else {
      await syncCollectionsToWorkspace(db, env, siteId)
    }

    return getSiteCollection(db, siteId, collection.id)
  } catch (error) {
    if (createdCollectionId !== null) {
      await db.delete(siteCollections).where(eq(siteCollections.id, createdCollectionId))
    }

    throw error
  }
}

export async function updateSiteCollection(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  input: { name?: string; description?: string },
) {
  const existing = await getSiteCollection(db, siteId, collectionId)

  if (!existing) {
    throw new Error("Collection not found")
  }

  const [collection] = await db
    .update(siteCollections)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(siteCollections.id, collectionId))
    .returning()

  if (!collection) {
    throw new Error("Failed to update collection")
  }

  if (input.name !== undefined) {
    const record = await getCollectionRecord(db, siteId, collectionId)
    if (record?.kind === "single") {
      await syncSingleTemplatePageName(db, env, siteId, {
        slug: collection.slug,
        name: collection.name,
      })
    } else if (record?.kind === "collection") {
      await syncCollectionTemplatePageName(db, env, siteId, {
        slug: collection.slug,
        name: collection.name,
      })
    }
  }

  await syncCollectionsToWorkspace(db, env, siteId)

  return getSiteCollection(db, siteId, collectionId)
}

export async function deleteSiteCollection(db: Db, env: Env, siteId: number, collectionId: number) {
  const existing = await getSiteCollection(db, siteId, collectionId)

  if (!existing) {
    return false
  }

  await db.delete(siteCollections).where(eq(siteCollections.id, collectionId))

  if (existing.kind === "single") {
    await removeSingleTemplatePage(db, env, siteId, existing.slug)
  } else if (existing.kind === "collection") {
    await removeCollectionTemplatePage(db, env, siteId, existing.slug)
  }

  await syncCollectionsToWorkspace(db, env, siteId)

  return true
}

export async function linkCollectionTemplatePage(db: Db, env: Env, siteId: number, collectionId: number) {
  const collection = await getSiteCollection(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Collection not found")
  }

  if (collection.kind === "global") {
    throw new Error("Global types are not linked to template pages")
  }

  if (collection.kind === "single") {
    await ensureSingleTemplatePage(db, env, siteId, {
      slug: collection.slug,
      name: collection.name,
    })
  } else {
    await ensureCollectionTemplatePage(db, env, siteId, {
      slug: collection.slug,
      name: collection.name,
    })
  }

  return getSiteCollection(db, siteId, collectionId)
}

export async function updateSiteCollectionModel(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  fieldsSchema: unknown,
) {
  const collection = await getCollectionRecord(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Collection not found")
  }

  const normalized = normalizeFieldsSchema(fieldsSchemaSchema.parse(fieldsSchema))

  if (normalized.length === 0) {
    throw new Error("Entry model must contain at least one field")
  }

  const keys = new Set<string>()
  for (const field of normalized) {
    if (keys.has(field.key)) {
      throw new Error(`Duplicate field key: ${field.key}`)
    }
    keys.add(field.key)
  }

  await db
    .update(siteCollections)
    .set({
      fieldsSchema: normalized,
      ...(collection.kind === "single" || collection.kind === "global"
        ? {
            singleData: validateFieldValues(normalized, collection.singleData ?? {}),
          }
        : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(siteCollections.id, collectionId))

  await syncCollectionsToWorkspace(db, env, siteId)

  return getSiteCollection(db, siteId, collectionId)
}

async function getCollectionRecord(db: Db, siteId: number, collectionId: number) {
  const [collection] = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.id, collectionId))

  if (!collection || collection.siteId !== siteId) {
    return null
  }

  return collection
}

export async function updateSingleTypeData(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  input: {
    data: Record<string, unknown>
    status?: "draft" | "published"
  },
) {
  const collection = await getCollectionRecord(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Content type not found")
  }

  if (collection.kind !== "single" && collection.kind !== "global") {
    throw new Error("This content type is a collection, not a single or global type")
  }

  const fieldsSchema = collection.fieldsSchema ?? []

  if (fieldsSchema.length === 0) {
    throw new Error("Define the field schema before saving content")
  }

  const data = validateFieldValues(fieldsSchema, input.data)
  const timestamp = new Date().toISOString()

  await db
    .update(siteCollections)
    .set({
      singleData: data,
      updatedAt: timestamp,
    })
    .where(eq(siteCollections.id, collectionId))

  await syncCollectionsToWorkspace(db, env, siteId)

  return getSiteCollection(db, siteId, collectionId)
}

export async function createCollectionEntry(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  input: {
    data: Record<string, unknown>
    slug?: string
    status?: "draft" | "published"
    publishedAt?: string | null
  },
) {
  const collection = await getCollectionRecord(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Collection not found")
  }

  if (collection.kind === "single" || collection.kind === "global") {
    throw new Error("Single and global types cannot have multiple entries. Edit content on the Content tab.")
  }

  const fieldsSchema = collection.fieldsSchema ?? []

  if (fieldsSchema.length === 0) {
    throw new Error("Define the entry model before creating content")
  }

  const data = validateFieldValues(fieldsSchema, input.data)
  const legacy = extractLegacyEntryColumns(data)
  const slug =
    input.slug?.trim() || (await ensureUniqueEntrySlug(db, collectionId, legacy.title))
  const timestamp = new Date().toISOString()
  const status = input.status ?? "draft"
  const publishedAt =
    input.publishedAt !== undefined
      ? input.publishedAt
      : status === "published"
        ? timestamp
        : null

  const [entry] = await db
    .insert(siteCollectionEntries)
    .values({
      collectionId,
      slug,
      title: legacy.title,
      excerpt: legacy.excerpt,
      body: legacy.body,
      data,
      status,
      publishedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!entry) {
    throw new Error("Failed to create entry")
  }

  await db
    .update(siteCollections)
    .set({ updatedAt: timestamp })
    .where(eq(siteCollections.id, collectionId))

  await syncCollectionsToWorkspace(db, env, siteId)

  return getSiteCollection(db, siteId, collectionId)
}

export async function updateCollectionEntry(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  entryId: number,
  input: {
    data?: Record<string, unknown>
    slug?: string
    status?: "draft" | "published"
    publishedAt?: string | null
  },
) {
  const collection = await getCollectionRecord(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Collection not found")
  }

  const [existingEntry] = await db
    .select()
    .from(siteCollectionEntries)
    .where(eq(siteCollectionEntries.id, entryId))

  if (!existingEntry || existingEntry.collectionId !== collectionId) {
    throw new Error("Entry not found")
  }

  const fieldsSchema = collection.fieldsSchema ?? []
  const timestamp = new Date().toISOString()
  const nextStatus = input.status ?? existingEntry.status
  const publishedAt =
    input.publishedAt !== undefined
      ? input.publishedAt
      : nextStatus === "published" && !existingEntry.publishedAt
        ? timestamp
        : existingEntry.publishedAt

  const mergedData =
    input.data !== undefined
      ? validateFieldValues(fieldsSchema, input.data)
      : mergeEntryDataForForm(existingEntry.data ?? {}, {
          title: existingEntry.title,
          excerpt: existingEntry.excerpt ?? "",
          body: existingEntry.body ?? "",
        })
  const legacy = extractLegacyEntryColumns(mergedData)

  await db
    .update(siteCollectionEntries)
    .set({
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      title: legacy.title,
      excerpt: legacy.excerpt,
      body: legacy.body,
      data: mergedData,
      ...(input.status !== undefined ? { status: input.status } : {}),
      publishedAt,
      updatedAt: timestamp,
    })
    .where(eq(siteCollectionEntries.id, entryId))

  await db
    .update(siteCollections)
    .set({ updatedAt: timestamp })
    .where(eq(siteCollections.id, collectionId))

  await syncCollectionsToWorkspace(db, env, siteId)

  return getSiteCollection(db, siteId, collectionId)
}

export async function deleteCollectionEntry(
  db: Db,
  env: Env,
  siteId: number,
  collectionId: number,
  entryId: number,
) {
  const collection = await getSiteCollection(db, siteId, collectionId)

  if (!collection) {
    throw new Error("Collection not found")
  }

  const [existingEntry] = await db
    .select()
    .from(siteCollectionEntries)
    .where(eq(siteCollectionEntries.id, entryId))

  if (!existingEntry || existingEntry.collectionId !== collectionId) {
    return false
  }

  await db.delete(siteCollectionEntries).where(eq(siteCollectionEntries.id, entryId))
  await syncCollectionsToWorkspace(db, env, siteId)

  return true
}
