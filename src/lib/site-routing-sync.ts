import type { Env } from "../env.js"
import type { Db } from "../db/index.js"
import { ensureSiteCustomCodeInWorkspace } from "../db/site-custom-code.js"
import { ensureSiteThemeInWorkspace } from "../db/site-theme.js"
import { getSiteById } from "../db/sites.js"
import { getCollectionsForGeneration, getGlobalForGeneration, getSinglesForGeneration } from "../db/site-collections.js"
import { getFormsForGeneration } from "../db/site-forms.js"
import { getSiteLayoutsForGeneration, resolveSitePageLayoutRef } from "../db/site-layout.js"
import { getSiteTemplate } from "../db/site-template.js"
import { notifySiteDevServerWorkspaceUpdated } from "./site-dev-server.js"
import { generateSiteCollections, generateSiteForms, generateSiteGlobalData, generateSitePageData } from "./site-content-generator.js"
import { generateSiteLayouts } from "./site-layout-generator.js"
import { generateSitePages } from "./site-page-generator.js"
import { syncComponentsToSite, syncSharedComponentsToSite } from "./site-component-sync.js"
import { collectComponentSlugsFromValue } from "./component-prop-schema.js"
import { enrichBlocksWithFormData } from "./site-form-props.js"
import { getCollectionSlugsFromTemplatePages } from "./site-template-collections.js"

function buildLayoutIdBySlug(pages: Array<{ slug: string; layoutId: string | null }>) {
  const layoutIdBySlug = new Map<string, number>()

  for (const page of pages) {
    if (page.layoutId != null) {
      layoutIdBySlug.set(page.slug, Number(page.layoutId))
    }
  }

  return layoutIdBySlug
}

function resolveEffectiveLayoutId(
  slug: string,
  layoutId: string | null,
  layoutIdBySlug: Map<string, number>,
) {
  return layoutIdBySlug.get(slug) ?? (layoutId != null ? Number(layoutId) : null)
}

export async function syncSiteWorkspaceRouting(db: Db, env: Env, siteId: number) {
  const template = await getSiteTemplate(db, env, siteId)
  const layoutsForGeneration = await getSiteLayoutsForGeneration(db, env, siteId)
  const collectionSlugs = getCollectionSlugsFromTemplatePages(template.pages)
  const collectionSlugSet = new Set(collectionSlugs)
  const layoutIdBySlug = buildLayoutIdBySlug(template.pages)
  const allSingles = await getSinglesForGeneration(db, siteId)
  const forms = await getFormsForGeneration(db, siteId)
  const apiBase = env.CMS_PUBLIC_URL

  const pagesForGeneration = await Promise.all(
    template.pages.map(async (page) => {
      const hasSingleContent =
        page.pageType === "static" && allSingles.some((single) => single.slug === page.slug)

      const layout = await resolveSitePageLayoutRef(
        db,
        siteId,
        resolveEffectiveLayoutId(page.slug, page.layoutId, layoutIdBySlug),
      )

      return {
        slug: page.slug,
        name: page.name,
        pageType: page.pageType,
        bindingContext: hasSingleContent ? ("single" as const) : null,
        layout,
        blocks: page.blocks.map((block) => ({
          componentSlug: block.componentSlug,
          variantSlug: block.variantSlug,
          props: block.props,
          themeColorMap: block.themeColorMap,
          collectionEntryLoop: block.collectionEntryLoop,
        })),
      }
    }),
  )

  const enrichedPagesForGeneration = pagesForGeneration.map((page) => ({
    ...page,
    blocks: enrichBlocksWithFormData(page.blocks, forms, siteId, apiBase),
  }))

  const entryBlocksBySlug = Object.fromEntries(
    template.pages
      .filter((page) => page.pageType === "collection")
      .map((page) => [
        page.slug,
        enrichBlocksWithFormData(
          page.blocks.map((block) => ({
            componentSlug: block.componentSlug,
            variantSlug: block.variantSlug,
            props: block.props,
            themeColorMap: block.themeColorMap,
          })),
          forms,
          siteId,
          apiBase,
        ),
      ]),
  )

  const entryLayoutBySlug = Object.fromEntries(
    await Promise.all(
      template.pages
        .filter((page) => page.pageType === "collection")
        .map(async (page) => [
          page.slug,
          await resolveSitePageLayoutRef(
            db,
            siteId,
            resolveEffectiveLayoutId(page.slug, page.layoutId, layoutIdBySlug),
          ),
        ]),
    ),
  )

  const enrichedLayoutsForGeneration = await Promise.all(
    layoutsForGeneration.map(async (layout) => ({
      slug: layout.slug,
      name: layout.name,
      isDefault: layout.isDefault,
      blocks: enrichBlocksWithFormData(layout.blocks, forms, siteId, apiBase),
    })),
  )

  const componentSlugs = new Set<string>()

  for (const layout of layoutsForGeneration) {
    for (const block of layout.blocks) {
      componentSlugs.add(block.componentSlug)
      for (const slug of collectComponentSlugsFromValue(block.props)) {
        componentSlugs.add(slug)
      }
    }
  }

  for (const page of template.pages) {
    for (const block of page.blocks) {
      componentSlugs.add(block.componentSlug)
      for (const slug of collectComponentSlugsFromValue(block.props)) {
        componentSlugs.add(slug)
      }
    }
  }

  await syncComponentsToSite(env.COMPONENT_PREVIEW_DIR, env.WORKSPACES_DIR, siteId, [...componentSlugs])
  await syncSharedComponentsToSite(env, siteId)

  const globalSettings = await getGlobalForGeneration(db, siteId)
  await generateSiteGlobalData(env.WORKSPACES_DIR, siteId, globalSettings)

  const globalFieldValues = globalSettings?.fieldValues ?? {}

  await generateSiteLayouts(env.WORKSPACES_DIR, siteId, enrichedLayoutsForGeneration)

  const allCollections = await getCollectionsForGeneration(db, siteId)
  const collectionsForRouting = allCollections.filter((collection) => collectionSlugSet.has(collection.slug))

  await generateSitePages(env.WORKSPACES_DIR, siteId, enrichedPagesForGeneration, {
    collectionSlugs,
  })

  await generateSiteCollections(env.WORKSPACES_DIR, siteId, collectionsForRouting, {
    entryBlocksBySlug,
    entryLayoutBySlug,
    globalFieldValues,
  })

  const staticPageSlugs = new Set(
    template.pages.filter((page) => page.pageType === "static").map((page) => page.slug),
  )
  const singlesForRouting = allSingles.filter((single) => staticPageSlugs.has(single.slug))

  await generateSitePageData(env.WORKSPACES_DIR, siteId, singlesForRouting, {
    globalFieldValues,
  })

  await generateSiteForms(env.WORKSPACES_DIR, siteId, forms, env.CMS_PUBLIC_URL)

  const site = await getSiteById(db, siteId)
  if (site?.cloneStatus === "ready") {
    await ensureSiteThemeInWorkspace(db, env, siteId)
    await ensureSiteCustomCodeInWorkspace(db, env, siteId)
    notifySiteDevServerWorkspaceUpdated(siteId)
  }
}
