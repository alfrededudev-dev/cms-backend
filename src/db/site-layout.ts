import { and, asc, eq } from "drizzle-orm"
import type { Env } from "../env.js"
import {
  getVariantPreviewProps,
  hasComponentVariant,
  humanizeVariantSlug,
  listComponentVariants,
  readVariantCode,
  readVariantPropsSchema,
  readPreviewJson,
} from "../lib/component-files.js"
import { assertLayoutComponentHasSlot } from "../lib/layout-component.js"
import { normalizeThemeColorMapping } from "../lib/theme-tokens.js"
import type { GeneratedLayoutBlock } from "../lib/site-layout-generator.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import { ensureSiteFormsForSlugs, collectFormSlugsFromBlocks } from "./site-forms.js"
import { ensureComponentPreviewWorkspace } from "../lib/component-preview-workspace.js"
import { slugifyLayoutName } from "../lib/slug.js"
import type { Db } from "./index.js"
import { components, siteLayoutBlocks, siteLayouts, sitePages } from "./schema.js"
import { getSiteById } from "./sites.js"

export type SiteLayoutBlockInput = {
  componentId: number
  variantSlug: string
  props?: Record<string, unknown>
  themeColorMap?: Record<string, string>
  sortOrder?: number
}

export type SiteLayoutSummary = {
  id: string
  name: string
  slug: string
  isDefault: boolean
  sortOrder: number
}

export type SiteLayoutDetails = SiteLayoutSummary & {
  blocks: Array<{
    id: string
    componentId: string
    componentSlug: string
    componentTitle: string
    variantSlug: string
    variantName: string
    props: Record<string, unknown>
    themeColorMap: Record<string, string>
    sortOrder: number
  }>
}

async function mapLayoutBlocks(db: Db, env: Env, layoutId: number) {
  const rows = await db
    .select({
      block: siteLayoutBlocks,
      component: components,
    })
    .from(siteLayoutBlocks)
    .innerJoin(components, eq(siteLayoutBlocks.componentId, components.id))
    .where(eq(siteLayoutBlocks.layoutId, layoutId))
    .orderBy(asc(siteLayoutBlocks.sortOrder), asc(siteLayoutBlocks.id))

  return Promise.all(
    rows.map(async (row) => {
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
        sortOrder: row.block.sortOrder,
      }
    }),
  )
}

function mapLayoutSummary(layout: typeof siteLayouts.$inferSelect): SiteLayoutSummary {
  return {
    id: String(layout.id),
    name: layout.name,
    slug: layout.slug,
    isDefault: layout.isDefault,
    sortOrder: layout.sortOrder,
  }
}

function uniqueLayoutSlug(baseSlug: string, existingSlugs: Set<string>) {
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug
  }

  let index = 2
  while (existingSlugs.has(`${baseSlug}-${index}`)) {
    index += 1
  }

  return `${baseSlug}-${index}`
}

export async function ensureDefaultSiteLayout(db: Db, siteId: number) {
  const [existingDefault] = await db
    .select()
    .from(siteLayouts)
    .where(and(eq(siteLayouts.siteId, siteId), eq(siteLayouts.isDefault, true)))
    .limit(1)

  if (existingDefault) {
    return existingDefault
  }

  const timestamp = new Date().toISOString()

  const [layout] = await db
    .insert(siteLayouts)
    .values({
      siteId,
      name: "Default",
      slug: "default",
      isDefault: true,
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!layout) {
    throw new Error("Failed to create default layout")
  }

  return layout
}

export async function listSiteLayouts(db: Db, siteId: number) {
  await ensureDefaultSiteLayout(db, siteId)

  const rows = await db
    .select()
    .from(siteLayouts)
    .where(eq(siteLayouts.siteId, siteId))
    .orderBy(asc(siteLayouts.sortOrder), asc(siteLayouts.id))

  return rows.map(mapLayoutSummary)
}

export async function getSiteLayoutById(db: Db, env: Env, siteId: number, layoutId: number) {
  await ensureComponentPreviewWorkspace(db, env)

  const [layout] = await db
    .select()
    .from(siteLayouts)
    .where(and(eq(siteLayouts.siteId, siteId), eq(siteLayouts.id, layoutId)))
    .limit(1)

  if (!layout) {
    throw new Error("Layout not found")
  }

  const blocks = await mapLayoutBlocks(db, env, layout.id)

  return {
    ...mapLayoutSummary(layout),
    blocks,
  } satisfies SiteLayoutDetails
}

export async function getDefaultSiteLayout(db: Db, siteId: number) {
  return ensureDefaultSiteLayout(db, siteId)
}

export async function getSiteLayout(db: Db, env: Env, siteId: number) {
  const defaultLayout = await getDefaultSiteLayout(db, siteId)
  return getSiteLayoutById(db, env, siteId, defaultLayout.id)
}

export async function getSiteLayoutsForGeneration(db: Db, env: Env, siteId: number) {
  await ensureDefaultSiteLayout(db, siteId)

  const layouts = await db
    .select()
    .from(siteLayouts)
    .where(eq(siteLayouts.siteId, siteId))
    .orderBy(asc(siteLayouts.sortOrder), asc(siteLayouts.id))

  const result = []

  for (const layout of layouts) {
    const blocks = await mapLayoutBlocks(db, env, layout.id)
    result.push({
      id: layout.id,
      slug: layout.slug,
      name: layout.name,
      isDefault: layout.isDefault,
      blocks: blocks.map(
        (block): GeneratedLayoutBlock => ({
          componentSlug: block.componentSlug,
          variantSlug: block.variantSlug,
          props: block.props,
          themeColorMap: block.themeColorMap,
        }),
      ),
    })
  }

  return result
}

export async function createSiteLayout(db: Db, env: Env, siteId: number, input: { name: string }) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  const name = input.name.trim()
  if (!name) {
    throw new Error("Layout name is required")
  }

  const defaultLayout = await ensureDefaultSiteLayout(db, siteId)
  const existingLayouts = await db.select().from(siteLayouts).where(eq(siteLayouts.siteId, siteId))
  const baseSlug = slugifyLayoutName(name) || "layout"
  const slug = uniqueLayoutSlug(baseSlug, new Set(existingLayouts.map((layout) => layout.slug)))
  const timestamp = new Date().toISOString()

  const [layout] = await db
    .insert(siteLayouts)
    .values({
      siteId,
      name,
      slug,
      isDefault: false,
      sortOrder: existingLayouts.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!layout) {
    throw new Error("Failed to create layout")
  }

  const defaultBlocks = await db
    .select()
    .from(siteLayoutBlocks)
    .where(eq(siteLayoutBlocks.layoutId, defaultLayout.id))
    .orderBy(asc(siteLayoutBlocks.sortOrder), asc(siteLayoutBlocks.id))

  for (const block of defaultBlocks) {
    await db.insert(siteLayoutBlocks).values({
      layoutId: layout.id,
      componentId: block.componentId,
      variantSlug: block.variantSlug,
      props: block.props,
      themeColorMap: block.themeColorMap,
      sortOrder: block.sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  await syncSiteWorkspaceRouting(db, env, siteId)

  return getSiteLayoutById(db, env, siteId, layout.id)
}

async function validateLayoutBlocks(db: Db, env: Env, blocks: SiteLayoutBlockInput[]) {
  await ensureComponentPreviewWorkspace(db, env)

  for (const blockInput of blocks) {
    const [component] = await db
      .select()
      .from(components)
      .where(eq(components.id, blockInput.componentId))

    if (!component) {
      throw new Error(`Component ${blockInput.componentId} not found`)
    }

    if (component.kind !== "layout") {
      throw new Error(
        `Template component "${component.title}" cannot be used in site layout. Use layout components instead.`,
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

    const variantCode = await readVariantCode(
      env.COMPONENT_PREVIEW_DIR,
      component.slug,
      blockInput.variantSlug,
    )
    assertLayoutComponentHasSlot(variantCode)
  }
}

export async function saveSiteLayoutById(
  db: Db,
  env: Env,
  siteId: number,
  layoutId: number,
  input: {
    blocks: SiteLayoutBlockInput[]
  },
) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  const [layout] = await db
    .select()
    .from(siteLayouts)
    .where(and(eq(siteLayouts.siteId, siteId), eq(siteLayouts.id, layoutId)))
    .limit(1)

  if (!layout) {
    throw new Error("Layout not found")
  }

  await validateLayoutBlocks(db, env, input.blocks)

  const timestamp = new Date().toISOString()

  await db.delete(siteLayoutBlocks).where(eq(siteLayoutBlocks.layoutId, layoutId))

  for (const [blockIndex, blockInput] of input.blocks.entries()) {
    const [component] = await db
      .select()
      .from(components)
      .where(eq(components.id, blockInput.componentId))

    if (!component) {
      throw new Error(`Component ${blockInput.componentId} not found`)
    }

    const preview = await readPreviewJson(env.COMPONENT_PREVIEW_DIR, component.slug)
    const schema = await readVariantPropsSchema(
      env.COMPONENT_PREVIEW_DIR,
      component.slug,
      blockInput.variantSlug,
    )
    const props =
      blockInput.props ?? getVariantPreviewProps(preview, blockInput.variantSlug, schema)

    await db.insert(siteLayoutBlocks).values({
      layoutId,
      componentId: component.id,
      variantSlug: blockInput.variantSlug,
      props,
      themeColorMap: normalizeThemeColorMapping(blockInput.themeColorMap),
      sortOrder: blockInput.sortOrder ?? blockIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  await db
    .update(siteLayouts)
    .set({ updatedAt: timestamp })
    .where(eq(siteLayouts.id, layoutId))

  const formSlugs = collectFormSlugsFromBlocks(
    input.blocks.map((block) => ({ props: block.props ?? {} })),
  )
  await ensureSiteFormsForSlugs(db, env, siteId, formSlugs)

  await syncSiteWorkspaceRouting(db, env, siteId)

  return getSiteLayoutById(db, env, siteId, layoutId)
}

export async function saveSiteLayout(
  db: Db,
  env: Env,
  siteId: number,
  input: {
    blocks: SiteLayoutBlockInput[]
  },
) {
  const defaultLayout = await ensureDefaultSiteLayout(db, siteId)
  return saveSiteLayoutById(db, env, siteId, defaultLayout.id, input)
}

export async function resolveSitePageLayoutRef(
  db: Db,
  siteId: number,
  layoutId: number | null | undefined,
) {
  const layouts = await listSiteLayouts(db, siteId)
  const defaultLayout = layouts.find((layout) => layout.isDefault) ?? layouts[0]

  if (!defaultLayout) {
    return { slug: "default", name: "Default", isDefault: true }
  }

  if (layoutId == null) {
    return { slug: defaultLayout.slug, name: defaultLayout.name, isDefault: defaultLayout.isDefault }
  }

  const selected = layouts.find((layout) => Number(layout.id) === layoutId)
  if (!selected) {
    return { slug: defaultLayout.slug, name: defaultLayout.name, isDefault: defaultLayout.isDefault }
  }

  return { slug: selected.slug, name: selected.name, isDefault: selected.isDefault }
}

export async function deleteSiteLayout(db: Db, env: Env, siteId: number, layoutId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  const [layout] = await db
    .select()
    .from(siteLayouts)
    .where(and(eq(siteLayouts.siteId, siteId), eq(siteLayouts.id, layoutId)))
    .limit(1)

  if (!layout) {
    throw new Error("Layout not found")
  }

  if (layout.isDefault) {
    throw new Error("Default layout cannot be deleted")
  }

  await db
    .update(sitePages)
    .set({ layoutId: null })
    .where(and(eq(sitePages.siteId, siteId), eq(sitePages.layoutId, layoutId)))

  await db.delete(siteLayouts).where(eq(siteLayouts.id, layoutId))

  await syncSiteWorkspaceRouting(db, env, siteId)

  return listSiteLayouts(db, siteId)
}
