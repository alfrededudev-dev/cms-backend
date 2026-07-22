import { asc, desc, eq } from "drizzle-orm"
import type { Env } from "../env.js"
import {
  addVariantWorkspace,
  createComponentWorkspace,
  deleteComponentWorkspace,
  deleteVariantWorkspace,
  ensureUniqueVariantSlug,
  listComponentVariants,
  readComponentPropsSchema,
  readVariantCode,
  renameVariantWorkspace,
  updateVariantPropsSchema as writeVariantPropsSchema,
  syncComponentPropsToCode as writeComponentPropsToCode,
  updateVariantPreviewProps,
  writeVariantCode,
  type FilesystemComponentVariant,
} from "../lib/component-files.js"
import { assertLayoutComponentHasSlot } from "../lib/layout-component.js"
import type { ComponentKind } from "../lib/component-kind.js"
import type { ComponentPropsSchema } from "../lib/component-prop-schema.js"
import { restartComponentDevServerIfRunning } from "../lib/component-dev-server.js"
import { ensureComponentPreviewWorkspace } from "../lib/component-preview-workspace.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import { syncComponentToSite } from "../lib/site-component-sync.js"
import { slugify, variantNameToSlug } from "../lib/slug.js"
import fs from "node:fs/promises"
import path from "node:path"
import { resolveComponentPreviewDir } from "../lib/paths.js"
import { getSiteById } from "./sites.js"
import type { Db } from "./index.js"
import { components, siteLayoutBlocks, siteLayouts, sitePageBlocks, sitePages, sites, type Component } from "./schema.js"
import { syncFormComponentToLinkedSites, syncSiteFormsFromBlocks } from "./site-forms.js"
import type { SiteFormBlockRef } from "../lib/form-component-sync.js"
import { replaceSiteTemplateBlock } from "./site-template.js"

export class ComponentInUseError extends Error {
  readonly usage: Array<{
    siteId: number
    siteName: string
    pageName: string
    pageSlug: string
  }>

  constructor(
    usage: Array<{
      siteId: number
      siteName: string
      pageName: string
      pageSlug: string
    }>,
  ) {
    const locations = [...new Set(usage.map((item) => `${item.siteName} → ${item.pageName}`))]
    super(
      locations.length === 1
        ? `Cannot delete component: it is used on ${locations[0]}. Remove it from the site template first.`
        : `Cannot delete component: it is used on ${locations.join(", ")}. Remove it from those site templates first.`,
    )
    this.name = "ComponentInUseError"
    this.usage = usage
  }
}

export type ComponentUsageItem = {
  blockId: number
  siteId: number
  siteName: string
  pageName: string
  pageSlug: string
  variantSlug: string
  props: Record<string, unknown>
  context: "template" | "layout"
}

export async function getComponentUsage(db: Db, componentId: number): Promise<ComponentUsageItem[]> {
  const templateUsage = await db
    .select({
      blockId: sitePageBlocks.id,
      siteId: sites.id,
      siteName: sites.name,
      pageName: sitePages.name,
      pageSlug: sitePages.slug,
      variantSlug: sitePageBlocks.variantSlug,
      props: sitePageBlocks.props,
    })
    .from(sitePageBlocks)
    .innerJoin(sitePages, eq(sitePageBlocks.pageId, sitePages.id))
    .innerJoin(sites, eq(sitePages.siteId, sites.id))
    .where(eq(sitePageBlocks.componentId, componentId))

  const layoutUsage = await db
    .select({
      blockId: siteLayoutBlocks.id,
      siteId: sites.id,
      siteName: sites.name,
      pageName: siteLayouts.name,
      pageSlug: siteLayouts.slug,
      variantSlug: siteLayoutBlocks.variantSlug,
      props: siteLayoutBlocks.props,
    })
    .from(siteLayoutBlocks)
    .innerJoin(siteLayouts, eq(siteLayoutBlocks.layoutId, siteLayouts.id))
    .innerJoin(sites, eq(siteLayouts.siteId, sites.id))
    .where(eq(siteLayoutBlocks.componentId, componentId))

  return [
    ...templateUsage.map((item) => ({ ...item, context: "template" as const })),
    ...layoutUsage.map((item) => ({ ...item, context: "layout" as const })),
  ].sort((left, right) => {
    const siteCompare = left.siteName.localeCompare(right.siteName)
    if (siteCompare !== 0) {
      return siteCompare
    }

    return left.pageName.localeCompare(right.pageName)
  })
}

async function getComponentSiteUsage(db: Db, componentId: number) {
  const usage = await getComponentUsage(db, componentId)

  return usage.map(({ siteId, siteName, pageName, pageSlug }) => ({
    siteId,
    siteName,
    pageName,
    pageSlug,
  }))
}

async function ensureUniqueComponentSlug(db: Db, title: string) {
  const baseSlug = slugify(title) || "component"
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const [existing] = await db.select({ id: components.id }).from(components).where(eq(components.slug, slug))
    if (!existing) {
      return slug
    }
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

export async function getComponentById(db: Db, componentId: number) {
  const [component] = await db.select().from(components).where(eq(components.id, componentId))
  return component ?? null
}

async function loadComponentVariants(
  db: Db,
  env: Env,
  component: Component,
): Promise<FilesystemComponentVariant[]> {
  await ensureComponentPreviewWorkspace(db, env)
  return listComponentVariants(env.COMPONENT_PREVIEW_DIR, component.slug)
}

export async function listComponents(db: Db, env: Env) {
  const items = await db.select().from(components).orderBy(desc(components.updatedAt))
  const result = []

  for (const component of items) {
    const variants = await loadComponentVariants(db, env, component)
    result.push({ component, variants })
  }

  return result
}

export async function getComponentWithVariants(db: Db, env: Env, componentId: number) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    return null
  }

  const variants = await loadComponentVariants(db, env, component)

  return { component, variants }
}

export async function mapComponentResponse(
  db: Db,
  env: Env,
  data: { component: Component; variants: FilesystemComponentVariant[] },
  options: { includeCode?: boolean } = {},
) {
  if (options.includeCode) {
    await ensureComponentPreviewWorkspace(db, env)
  }

  const variants = await Promise.all(
    data.variants.map(async (variant) => {
      let code: string | undefined

      if (options.includeCode) {
        code = await readVariantCode(env.COMPONENT_PREVIEW_DIR, data.component.slug, variant.slug)
      }

      return {
        id: variant.slug,
        slug: variant.slug,
        name: variant.name,
        sortOrder: variant.sortOrder,
        previewProps: variant.previewProps,
        propsSchema: variant.propsSchema,
        code,
        previewUrl: `/preview/${data.component.slug}/${variant.slug}`,
      }
    }),
  )

  const propsSchema = data.variants[0]?.propsSchema ?? (await readComponentPropsSchema(env.COMPONENT_PREVIEW_DIR, data.component.slug))

  return {
    id: String(data.component.id),
    slug: data.component.slug,
    title: data.component.title,
    icon: data.component.icon,
    kind: data.component.kind,
    propsSchema,
    variants,
    variantCount: variants.length,
    createdAt: data.component.createdAt,
    updatedAt: data.component.updatedAt,
  }
}

export async function createComponent(
  db: Db,
  env: Env,
  input: {
    title: string
    icon?: string
    kind?: ComponentKind
  },
) {
  const kind = input.kind ?? "template"
  const slug = await ensureUniqueComponentSlug(db, input.title)
  const timestamp = new Date().toISOString()
  const initialVariantSlug = "default"
  const defaultIcon =
    kind === "layout" ? "LayoutGrid" : kind === "form" ? "ClipboardList" : "LayoutTemplate"

  const [component] = await db
    .insert(components)
    .values({
      slug,
      title: input.title,
      icon: input.icon ?? defaultIcon,
      kind,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!component) {
    throw new Error("Failed to create component")
  }

  await ensureComponentPreviewWorkspace(db, env)
  await createComponentWorkspace(env.COMPONENT_PREVIEW_DIR, slug, initialVariantSlug, kind)
  await restartComponentDevServerIfRunning(env, db)

  const variants = await loadComponentVariants(db, env, component)

  return { component, variants }
}

export async function updateComponent(
  db: Db,
  componentId: number,
  input: {
    title?: string
    icon?: string
  },
) {
  const [component] = await db
    .update(components)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(components.id, componentId))
    .returning()

  return component
}

export async function deleteComponent(db: Db, env: Env, componentId: number) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    return false
  }

  const usage = await getComponentSiteUsage(db, componentId)

  if (usage.length > 0) {
    throw new ComponentInUseError(usage)
  }

  await db.delete(components).where(eq(components.id, componentId))
  await ensureComponentPreviewWorkspace(db, env)
  await deleteComponentWorkspace(env.COMPONENT_PREVIEW_DIR, component.slug)

  return true
}

export async function addComponentVariant(
  db: Db,
  env: Env,
  componentId: number,
  input: {
    name: string
    code?: string
    previewProps?: Record<string, unknown>
    propsSchema?: ComponentPropsSchema
  },
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspace(db, env)
  const existingVariants = await listComponentVariants(env.COMPONENT_PREVIEW_DIR, component.slug)
  const slug = await ensureUniqueVariantSlug(env.COMPONENT_PREVIEW_DIR, component.slug, input.name)
  const kind = component.kind as ComponentKind

  let code = input.code
  let previewProps = input.previewProps
  let propsSchema = input.propsSchema

  if (code === undefined) {
    const firstVariant = existingVariants.at(0)

    if (firstVariant) {
      code = await readVariantCode(env.COMPONENT_PREVIEW_DIR, component.slug, firstVariant.slug)

      if (previewProps === undefined) {
        previewProps = firstVariant.previewProps
      }

      if (propsSchema === undefined) {
        propsSchema = firstVariant.propsSchema
      }
    }
  }

  await addVariantWorkspace(
    env.COMPONENT_PREVIEW_DIR,
    component.slug,
    slug,
    previewProps,
    code,
    kind,
    propsSchema,
  )

  await restartComponentDevServerIfRunning(env, db)

  const timestamp = new Date().toISOString()

  await db
    .update(components)
    .set({ updatedAt: timestamp })
    .where(eq(components.id, componentId))

  return slug
}

async function ensureComponentPreviewWorkspaceForVariantUpdate(
  db: Db,
  env: Env,
  input: {
    name?: string
    code?: string
    previewProps?: Record<string, unknown>
  },
) {
  const codeOnly =
    input.code !== undefined && input.name === undefined && input.previewProps === undefined

  if (!codeOnly) {
    await ensureComponentPreviewWorkspace(db, env)
    return
  }

  const previewDir = resolveComponentPreviewDir(env.COMPONENT_PREVIEW_DIR)

  try {
    await fs.access(path.join(previewDir, "package.json"))
  } catch {
    await ensureComponentPreviewWorkspace(db, env)
  }
}

export async function cloneComponentVariant(
  db: Db,
  env: Env,
  componentId: number,
  sourceVariantSlug: string,
  input: {
    name?: string
  } = {},
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspace(db, env)

  const existingVariants = await listComponentVariants(env.COMPONENT_PREVIEW_DIR, component.slug)
  const sourceVariant = existingVariants.find((item) => item.slug === sourceVariantSlug)

  if (!sourceVariant) {
    throw new Error("Variant not found")
  }

  const baseName = input.name?.trim() || `Copy of ${sourceVariant.name}`
  const name = input.name?.trim() ? input.name.trim() : (() => {
    let nextName = baseName
    let suffix = 2

    while (existingVariants.some((item) => item.name.toLowerCase() === nextName.toLowerCase())) {
      nextName = `${baseName} ${suffix}`
      suffix += 1
    }

    return nextName
  })()

  const code = await readVariantCode(env.COMPONENT_PREVIEW_DIR, component.slug, sourceVariantSlug)

  return addComponentVariant(db, env, componentId, {
    name,
    code,
    previewProps: sourceVariant.previewProps,
    propsSchema: sourceVariant.propsSchema,
  })
}

export async function updateComponentVariant(
  db: Db,
  env: Env,
  componentId: number,
  variantSlug: string,
  input: {
    name?: string
    code?: string
    previewProps?: Record<string, unknown>
  },
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspaceForVariantUpdate(db, env, input)

  const existingVariants = await listComponentVariants(env.COMPONENT_PREVIEW_DIR, component.slug)
  const variant = existingVariants.find((item) => item.slug === variantSlug)

  if (!variant) {
    throw new Error("Variant not found")
  }

  let activeSlug = variantSlug

  if (input.name !== undefined) {
    const nextSlug = variantNameToSlug(input.name) || variantSlug

    if (nextSlug !== variantSlug) {
      const taken = existingVariants.some((item) => item.slug === nextSlug)

      if (taken) {
        throw new Error(`Variant slug "${nextSlug}" already exists`)
      }

      await renameVariantWorkspace(env.COMPONENT_PREVIEW_DIR, component.slug, variantSlug, nextSlug)
      activeSlug = nextSlug
    }
  }

  if (input.code !== undefined) {
    if (component.kind === "layout") {
      assertLayoutComponentHasSlot(input.code)
    }

    await writeVariantCode(env.COMPONENT_PREVIEW_DIR, component.slug, activeSlug, input.code)
  }

  if (input.previewProps !== undefined) {
    await updateVariantPreviewProps(
      env.COMPONENT_PREVIEW_DIR,
      component.slug,
      activeSlug,
      input.previewProps,
    )

    if (component.kind === "form") {
      const usage = await getComponentUsage(db, componentId)
      await syncFormComponentToLinkedSites(db, env, componentId, component.slug, usage)
    }
  }

  const timestamp = new Date().toISOString()

  await db
    .update(components)
    .set({ updatedAt: timestamp })
    .where(eq(components.id, componentId))

  return activeSlug
}

export async function updateComponentPropsSchema(
  db: Db,
  env: Env,
  componentId: number,
  variantSlug: string,
  schema: ComponentPropsSchema,
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspace(db, env)
  await writeVariantPropsSchema(env.COMPONENT_PREVIEW_DIR, component.slug, variantSlug, schema)

  const timestamp = new Date().toISOString()

  await db
    .update(components)
    .set({ updatedAt: timestamp })
    .where(eq(components.id, componentId))
}

export async function syncComponentPropsToCode(
  db: Db,
  env: Env,
  componentId: number,
  variantSlug: string,
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspace(db, env)
  await writeComponentPropsToCode(env.COMPONENT_PREVIEW_DIR, component.slug, variantSlug)

  const timestamp = new Date().toISOString()

  await db
    .update(components)
    .set({ updatedAt: timestamp })
    .where(eq(components.id, componentId))
}

export async function deleteComponentVariant(
  db: Db,
  env: Env,
  componentId: number,
  variantSlug: string,
) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  await ensureComponentPreviewWorkspace(db, env)
  const variants = await listComponentVariants(env.COMPONENT_PREVIEW_DIR, component.slug)

  if (variants.length <= 1) {
    throw new Error("Component must have at least one variant")
  }

  const variant = variants.find((item) => item.slug === variantSlug)

  if (!variant) {
    throw new Error("Variant not found")
  }

  await deleteVariantWorkspace(env.COMPONENT_PREVIEW_DIR, component.slug, variantSlug)

  await db
    .update(components)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(components.id, componentId))

  return true
}

export async function replaceComponentUsageVariant(
  db: Db,
  env: Env,
  sourceComponentId: number,
  blockId: number,
  variantSlug: string,
  props?: Record<string, unknown>,
) {
  const [block] = await db.select().from(sitePageBlocks).where(eq(sitePageBlocks.id, blockId))

  if (!block) {
    throw new Error("Block not found")
  }

  if (block.componentId !== sourceComponentId) {
    throw new Error("This placement no longer uses the current component")
  }

  if (block.variantSlug === variantSlug) {
    const [page] = await db.select().from(sitePages).where(eq(sitePages.id, block.pageId))

    return {
      blockId,
      siteId: page?.siteId ?? 0,
      componentId: sourceComponentId,
      variantSlug,
    }
  }

  return replaceSiteTemplateBlock(db, env, blockId, {
    componentId: sourceComponentId,
    variantSlug,
    props,
  })
}

export async function syncComponentUsageToSite(db: Db, env: Env, componentId: number, siteId: number) {
  const component = await getComponentById(db, componentId)

  if (!component) {
    throw new Error("Component not found")
  }

  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  const placements = (await getComponentUsage(db, componentId)).filter((item) => item.siteId === siteId)

  if (placements.length === 0) {
    throw new Error("Component is not used on this site")
  }

  await ensureComponentPreviewWorkspace(db, env)
  await syncComponentToSite(env.COMPONENT_PREVIEW_DIR, env.WORKSPACES_DIR, siteId, component.slug)

  let syncedForms = 0
  if (component.kind === "form") {
    const formBlocks: SiteFormBlockRef[] = placements.map((item) => ({
      componentId,
      componentSlug: component.slug,
      variantSlug: item.variantSlug,
      props: item.props,
    }))
    await syncSiteFormsFromBlocks(db, env, siteId, formBlocks)
    syncedForms = formBlocks.filter(
      (block) => typeof block.props.formSlug === "string" && block.props.formSlug.trim(),
    ).length
  }

  await syncSiteWorkspaceRouting(db, env, siteId)

  return {
    siteId,
    siteName: site.name,
    componentSlug: component.slug,
    updatedPlacements: placements.length,
    syncedForms,
  }
}
