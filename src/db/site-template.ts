import { asc, eq } from "drizzle-orm"
import type { Env } from "../env.js"
import {
  getVariantPreviewProps,
  hasComponentVariant,
  humanizeVariantSlug,
  listComponentVariants,
  readVariantPropsSchema,
  readPreviewJson,
} from "../lib/component-files.js"
import { mergePreviewPropsWithSchema } from "../lib/component-prop-schema.js"
import { normalizeThemeColorMapping } from "../lib/theme-tokens.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import { syncSiteFormsFromBlocks } from "./site-forms.js"
import type { SiteFormBlockRef } from "../lib/form-component-sync.js"
import { syncComponentsToSite, syncSharedComponentsToSite } from "../lib/site-component-sync.js"
import { syncTemplateCollections, type SiteTemplatePageType } from "../lib/site-template-collections.js"
import type { DataFieldDefinition } from "../lib/data-model.js"
import { isHomeSlug, canAddTemplatePageSlug } from "../lib/site-routing.js"
import { isPageTemplateComponentKind } from "../lib/component-kind.js"
import { ensureComponentPreviewWorkspace } from "../lib/component-preview-workspace.js"
import type { Db } from "./index.js"
import { components, siteCollectionEntries, siteCollections, sitePageBlocks, sitePages } from "./schema.js"
import { getSiteById } from "./sites.js"

function globalTypeHasContent(data: Record<string, unknown>) {
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

export type SiteTemplateBlockInput = {
  componentId: number
  variantSlug: string
  props?: Record<string, unknown>
  themeColorMap?: Record<string, string>
  collectionEntryLoop?: boolean
  sortOrder?: number
}

export type SiteTemplatePageInput = {
  slug: string
  name: string
  pageType?: SiteTemplatePageType
  layoutId?: number | null
  sortOrder?: number
  blocks: SiteTemplateBlockInput[]
}

function syncTemplatePageLayoutIds(pages: SiteTemplatePageInput[]) {
  const layoutIdBySlug = new Map<string, number>()

  for (const page of pages) {
    if (page.layoutId != null) {
      layoutIdBySlug.set(page.slug, page.layoutId)
    }
  }

  return pages.map((page) => ({
    ...page,
    layoutId: layoutIdBySlug.get(page.slug) ?? page.layoutId ?? null,
  }))
}

export async function ensureDefaultSiteTemplate(db: Db, siteId: number) {
  const existing = await db.select().from(sitePages).where(eq(sitePages.siteId, siteId))

  if (existing.length > 0) {
    return
  }

  const timestamp = new Date().toISOString()

  await db.insert(sitePages).values({
    siteId,
    slug: "home",
    name: "Home",
    pageType: "static",
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function getSiteTemplate(db: Db, env: Env, siteId: number) {
  await ensureDefaultSiteTemplate(db, siteId)
  await ensureComponentPreviewWorkspace(db, env)

  const pages = await db
    .select()
    .from(sitePages)
    .where(eq(sitePages.siteId, siteId))
    .orderBy(asc(sitePages.sortOrder), asc(sitePages.id))

  const collections = await db
    .select()
    .from(siteCollections)
    .where(eq(siteCollections.siteId, siteId))

  const collectionsBySlug = new Map(collections.map((collection) => [collection.slug, collection]))
  const globalType = collections.find((collection) => collection.kind === "global") ?? null
  const entryCounts = new Map<string, number>()

  for (const collection of collections) {
    const entries = await db
      .select({ id: siteCollectionEntries.id })
      .from(siteCollectionEntries)
      .where(eq(siteCollectionEntries.collectionId, collection.id))

    entryCounts.set(collection.slug, entries.length)
  }

  const result = []

  for (const page of pages) {
    const blocks = await db
      .select({
        block: sitePageBlocks,
        component: components,
      })
      .from(sitePageBlocks)
      .innerJoin(components, eq(sitePageBlocks.componentId, components.id))
      .where(eq(sitePageBlocks.pageId, page.id))
      .orderBy(asc(sitePageBlocks.sortOrder), asc(sitePageBlocks.id))

    const variantRows = await Promise.all(
      blocks.map(async (row) => {
        const variants = await listComponentVariants(env.COMPONENT_PREVIEW_DIR, row.component.slug)
        const matchedVariant = variants.find((item) => item.slug === row.block.variantSlug)

        return {
          id: String(row.block.id),
          componentId: String(row.component.id),
          componentSlug: row.component.slug,
          componentTitle: row.component.title,
          variantSlug: row.block.variantSlug,
          variantName: matchedVariant?.name ?? humanizeVariantSlug(row.block.variantSlug),
          props: row.block.props,
          themeColorMap: normalizeThemeColorMapping(row.block.themeColorMap),
          collectionEntryLoop: row.block.collectionEntryLoop,
          sortOrder: row.block.sortOrder,
        }
      }),
    )

    const linkedCollection = collectionsBySlug.get(page.slug)
    let contentModel: {
      kind: "single" | "collection"
      linked: boolean
      fieldsSchema: DataFieldDefinition[]
      entryCount: number
    } | null = null

    if (linkedCollection) {
      if (page.pageType === "collection" && linkedCollection.kind === "collection") {
        contentModel = {
          kind: "collection",
          linked: true,
          fieldsSchema: linkedCollection.fieldsSchema ?? [],
          entryCount: entryCounts.get(page.slug) ?? 0,
        }
      } else if (page.pageType === "static" && linkedCollection.kind === "single") {
        contentModel = {
          kind: "single",
          linked: true,
          fieldsSchema: linkedCollection.fieldsSchema ?? [],
          entryCount: 0,
        }
      } else if (page.pageType === "static" && linkedCollection.kind === "collection") {
        contentModel = {
          kind: "collection",
          linked: true,
          fieldsSchema: linkedCollection.fieldsSchema ?? [],
          entryCount: entryCounts.get(page.slug) ?? 0,
        }
      }
    } else if (page.pageType === "collection") {
      contentModel = {
        kind: "collection",
        linked: false,
        fieldsSchema: [],
        entryCount: 0,
      }
    }

    result.push({
      id: String(page.id),
      slug: page.slug,
      name: page.name,
      pageType: page.pageType,
      layoutId: page.layoutId ? String(page.layoutId) : null,
      sortOrder: page.sortOrder,
      blocks: variantRows,
      contentModel,
      collectionModel:
        page.pageType === "collection"
          ? {
              linked: collectionsBySlug.has(page.slug),
              fieldCount: collectionsBySlug.get(page.slug)?.fieldsSchema?.length ?? 0,
              entryCount: entryCounts.get(page.slug) ?? 0,
            }
          : null,
    })
  }

  return {
    pages: result,
    globalModel: globalType
      ? {
          linked: true,
          fieldsSchema: globalType.fieldsSchema ?? [],
          hasContent: globalTypeHasContent(globalType.singleData ?? {}),
        }
      : null,
  }
}

export async function saveSiteTemplate(
  db: Db,
  env: Env,
  siteId: number,
  input: { pages: SiteTemplatePageInput[] },
) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  if (input.pages.length === 0) {
    throw new Error("Template must contain at least one page")
  }

  for (const page of input.pages) {
    const pageType = page.pageType ?? "static"

    if (isHomeSlug(page.slug) && pageType === "collection") {
      throw new Error("Home page cannot be a collection template")
    }
  }

  for (const page of input.pages) {
    const pageType = page.pageType ?? "static"
    const others = input.pages.filter((candidate) => candidate !== page)

    if (!canAddTemplatePageSlug(page.slug, pageType, others.map((candidate) => ({
      slug: candidate.slug,
      pageType: candidate.pageType ?? "static",
    })))) {
      throw new Error(
        `Duplicate ${pageType} page with slug "${page.slug}". Use one collection page and one static page for the same slug.`,
      )
    }
  }

  await ensureComponentPreviewWorkspace(db, env)

  const normalizedPages = syncTemplatePageLayoutIds(input.pages)

  const timestamp = new Date().toISOString()

  await db.delete(sitePages).where(eq(sitePages.siteId, siteId))

  const componentSlugById = new Map<number, string>()
  const formBlocksToSync: SiteFormBlockRef[] = []

  for (const [pageIndex, pageInput] of normalizedPages.entries()) {
    const pageType = pageInput.pageType ?? "static"

    const [page] = await db
      .insert(sitePages)
      .values({
        siteId,
        slug: pageInput.slug,
        name: pageInput.name,
        pageType,
        layoutId: pageInput.layoutId ?? null,
        sortOrder: pageInput.sortOrder ?? pageIndex,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()

    if (!page) {
      throw new Error("Failed to save page")
    }

    for (const [blockIndex, blockInput] of pageInput.blocks.entries()) {
      const [component] = await db
        .select()
        .from(components)
        .where(eq(components.id, blockInput.componentId))

      if (!component) {
        throw new Error(`Component ${blockInput.componentId} not found`)
      }

      if (!isPageTemplateComponentKind(component.kind)) {
        throw new Error(
          `Component "${component.title}" cannot be used in page templates. Use template or form components.`,
        )
      }

      const variantExists = await hasComponentVariant(
        env.COMPONENT_PREVIEW_DIR,
        component.slug,
        blockInput.variantSlug,
      )

      if (!variantExists) {
        throw new Error(`Variant ${blockInput.variantSlug} not found for component ${component.title}`)
      }

      const preview = await readPreviewJson(env.COMPONENT_PREVIEW_DIR, component.slug)
      const schema = await readVariantPropsSchema(
        env.COMPONENT_PREVIEW_DIR,
        component.slug,
        blockInput.variantSlug,
      )
      const props =
        blockInput.props ??
        getVariantPreviewProps(preview, blockInput.variantSlug, schema)

      await db.insert(sitePageBlocks).values({
        pageId: page.id,
        componentId: component.id,
        variantSlug: blockInput.variantSlug,
        props,
        themeColorMap: normalizeThemeColorMapping(blockInput.themeColorMap),
        collectionEntryLoop: blockInput.collectionEntryLoop ?? false,
        sortOrder: blockInput.sortOrder ?? blockIndex,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      componentSlugById.set(component.id, component.slug)

      if (component.kind === "form") {
        formBlocksToSync.push({
          componentId: component.id,
          componentSlug: component.slug,
          variantSlug: blockInput.variantSlug,
          props,
        })
      }
    }
  }

  await syncTemplateCollections(
    db,
    siteId,
    input.pages.map((page) => ({
      slug: page.slug,
      name: page.name,
      pageType: page.pageType ?? "static",
    })),
    timestamp,
  )

  await syncComponentsToSite(
    env.COMPONENT_PREVIEW_DIR,
    env.WORKSPACES_DIR,
    siteId,
    [...componentSlugById.values()],
  )

  await syncSharedComponentsToSite(env, siteId)

  await syncSiteFormsFromBlocks(db, env, siteId, formBlocksToSync)

  await syncSiteWorkspaceRouting(db, env, siteId)

  return getSiteTemplate(db, env, siteId)
}

async function getSiteComponentSlugs(db: Db, siteId: number) {
  const rows = await db
    .select({ slug: components.slug })
    .from(sitePageBlocks)
    .innerJoin(sitePages, eq(sitePageBlocks.pageId, sitePages.id))
    .innerJoin(components, eq(sitePageBlocks.componentId, components.id))
    .where(eq(sitePages.siteId, siteId))

  return [...new Set(rows.map((row) => row.slug))]
}

export async function replaceSiteTemplateBlock(
  db: Db,
  env: Env,
  blockId: number,
  input: {
    componentId: number
    variantSlug: string
    props?: Record<string, unknown>
    themeColorMap?: Record<string, string>
  },
) {
  const [blockRow] = await db
    .select({
      block: sitePageBlocks,
      page: sitePages,
    })
    .from(sitePageBlocks)
    .innerJoin(sitePages, eq(sitePageBlocks.pageId, sitePages.id))
    .where(eq(sitePageBlocks.id, blockId))

  if (!blockRow) {
    throw new Error("Block not found")
  }

  const site = await getSiteById(db, blockRow.page.siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  const [component] = await db.select().from(components).where(eq(components.id, input.componentId))

  if (!component) {
    throw new Error("Component not found")
  }

  if (!isPageTemplateComponentKind(component.kind)) {
    throw new Error(`Only template or form components can be used in page templates`)
  }

  await ensureComponentPreviewWorkspace(db, env)

  const variantExists = await hasComponentVariant(
    env.COMPONENT_PREVIEW_DIR,
    component.slug,
    input.variantSlug,
  )

  if (!variantExists) {
    throw new Error(`Variant ${input.variantSlug} not found for component ${component.title}`)
  }

  const preview = await readPreviewJson(env.COMPONENT_PREVIEW_DIR, component.slug)
  const schema = await readVariantPropsSchema(
    env.COMPONENT_PREVIEW_DIR,
    component.slug,
    input.variantSlug,
  )
  const props = input.props
    ? mergePreviewPropsWithSchema(schema, input.props)
    : getVariantPreviewProps(preview, input.variantSlug, schema)
  const timestamp = new Date().toISOString()

  await db
    .update(sitePageBlocks)
    .set({
      componentId: component.id,
      variantSlug: input.variantSlug,
      props,
      themeColorMap: normalizeThemeColorMapping(input.themeColorMap),
      updatedAt: timestamp,
    })
    .where(eq(sitePageBlocks.id, blockId))

  const componentSlugs = await getSiteComponentSlugs(db, site.id)

  await syncComponentsToSite(env.COMPONENT_PREVIEW_DIR, env.WORKSPACES_DIR, site.id, componentSlugs)
  await syncSharedComponentsToSite(env, site.id)
  await syncSiteWorkspaceRouting(db, env, site.id)

  return {
    blockId,
    siteId: site.id,
    componentId: component.id,
    variantSlug: input.variantSlug,
  }
}

export async function initializeSiteTemplate(db: Db, siteId: number) {
  await ensureDefaultSiteTemplate(db, siteId)
}
