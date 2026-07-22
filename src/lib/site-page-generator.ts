import fs from "node:fs/promises"
import path from "node:path"
import {
  type ContentBindingContext,
  getSiteSettingsImportPath,
  serializeBoundProps,
} from "./content-binding.js"
import { buildBlockThemeScopeStyle, normalizeThemeColorMapping, type ThemeColorMapping } from "./theme-tokens.js"
import { getSiteWorkspacePath } from "./paths.js"
import {
  filePathToPageSlug,
  getImportPrefix,
  isHomeSlug,
  isManagedCollectionEntryRoute,
  pageSlugToFilePath,
} from "./site-routing.js"
import { getLayoutImportStatement, layoutToImportAlias, type SiteLayoutRef } from "./layout-routing.js"
import { variantSlugToFileName } from "./slug.js"

export type GeneratedBlock = {
  componentSlug: string
  variantSlug: string
  props: Record<string, unknown>
  themeColorMap?: ThemeColorMapping
  collectionEntryLoop?: boolean
}

export type GeneratedPage = {
  slug: string
  name: string
  pageType?: "static" | "collection"
  blocks: GeneratedBlock[]
  bindingContext?: ContentBindingContext | null
  layout?: SiteLayoutRef
}

function toImportAlias(index: number, componentSlug: string) {
  const safeSlug = componentSlug.replace(/[^a-zA-Z0-9]/g, "_")
  return `Block${index}_${safeSlug}`
}

function toCollectionImportAlias(collectionSlug: string) {
  return `collection_${collectionSlug.replace(/[^a-zA-Z0-9]/g, "_")}`
}

function getPageDataImportPath(pageSlug: string, relativePagePath: string) {
  const importPrefix = getImportPrefix(relativePagePath)
  const dataSlug = isHomeSlug(pageSlug) ? "home" : pageSlug
  return `import pageData from "${importPrefix}data/pages/${dataSlug}.json"`
}

function renderBlockMarkup(
  block: GeneratedBlock,
  index: number,
  bindingContext: ContentBindingContext | null,
  options: {
    isListPage: boolean
  },
) {
  const alias = toImportAlias(index, block.componentSlug)
  const useEntryLoop = options.isListPage && Boolean(block.collectionEntryLoop)
  const props = serializeBoundProps(block.props, useEntryLoop ? "entry" : bindingContext)
  const scopeStyle = buildBlockThemeScopeStyle(normalizeThemeColorMapping(block.themeColorMap))
  const componentMarkup = props ? `<${alias} ${props} />` : `<${alias} />`

  const wrappedMarkup = scopeStyle
    ? `  <div class="cms-block-theme" style="${scopeStyle}">\n    ${componentMarkup}\n  </div>`
    : `  ${componentMarkup}`

  if (!useEntryLoop) {
    return wrappedMarkup
  }

  return `{publishedEntries.map((entry) => (\n${wrappedMarkup}\n))}`
}

export function generatePageContent(
  page: GeneratedPage,
  relativePagePath: string,
  options: {
    collectionSlugs?: ReadonlySet<string>
  } = {},
) {
  const importPrefix = getImportPrefix(relativePagePath)
  const bindingContext = page.bindingContext ?? null
  const isListPage = options.collectionSlugs?.has(page.slug) ?? false
  const hasLoopBlocks = isListPage && page.blocks.some((block) => block.collectionEntryLoop)
  const extraImports: string[] = []

  if (bindingContext === "single") {
    extraImports.push(getPageDataImportPath(page.slug, relativePagePath))
  }

  extraImports.push(getSiteSettingsImportPath(relativePagePath))

  if (hasLoopBlocks) {
    const collectionAlias = toCollectionImportAlias(page.slug)
    extraImports.push(
      `import ${collectionAlias} from "${importPrefix}data/collections/${page.slug}.json"`,
    )
  }

  const imports = page.blocks
    .map((block, index) => {
      const alias = toImportAlias(index, block.componentSlug)
      const fileName = variantSlugToFileName(block.variantSlug)
      return `import ${alias} from "${importPrefix}components/blocks/${block.componentSlug}/${fileName}"`
    })
    .join("\n")

  const body = page.blocks
    .map((block, index) => renderBlockMarkup(block, index, bindingContext, { isListPage }))
    .join("\n")

  const layoutTitle =
    bindingContext === "single" ? "pageData.name" : JSON.stringify(page.name)

  const frontmatterSetup = hasLoopBlocks
    ? `\nconst publishedEntries = ${toCollectionImportAlias(page.slug)}.entries.filter((entry) => entry.status === "published")`
    : ""

  const layoutRef = page.layout ?? { slug: "default", name: "Default", isDefault: true }
  const layoutImport = getLayoutImportStatement(relativePagePath, layoutRef)
  const layoutAlias = layoutToImportAlias(layoutRef)

  return `---
${layoutImport}
${[...extraImports, imports].filter(Boolean).join("\n")}${frontmatterSetup}
---

<${layoutAlias} title={${layoutTitle}}>
${body || "  <!-- empty page -->"}
</${layoutAlias}>
`
}

export function generateBlocksMarkup(
  blocks: GeneratedBlock[],
  relativePagePath: string,
  bindingContext: ContentBindingContext | null,
) {
  const importPrefix = getImportPrefix(relativePagePath)

  const imports = blocks
    .map((block, index) => {
      const alias = toImportAlias(index, block.componentSlug)
      const fileName = variantSlugToFileName(block.variantSlug)
      return `import ${alias} from "${importPrefix}components/blocks/${block.componentSlug}/${fileName}"`
    })
    .join("\n")

  const body = blocks
    .map((block, index) =>
      renderBlockMarkup(block, index, bindingContext, { isListPage: false }),
    )
    .join("\n")

  return { imports, body }
}

async function cleanupOrphanPages(
  pagesDir: string,
  managedPaths: Set<string>,
  collectionSlugs: ReadonlySet<string>,
) {
  async function walk(currentDir: string, relativePrefix: string) {
    let entries

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name === "preview") {
        continue
      }

      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      const absolutePath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
        continue
      }

      if (!entry.name.endsWith(".astro")) {
        continue
      }

      const managedPath = `src/pages/${relativePath}`

      if (isManagedCollectionEntryRoute(managedPath, collectionSlugs)) {
        continue
      }

      if (!managedPaths.has(managedPath)) {
        await fs.unlink(absolutePath)
      }
    }
  }

  await walk(pagesDir, "")
}

export async function generateSitePages(
  workspacesDir: string,
  siteId: number,
  pages: GeneratedPage[],
  options: {
    collectionSlugs?: string[]
  } = {},
) {
  const collectionSlugs = new Set(
    pages
      .filter((page) => page.pageType === "collection")
      .map((page) => page.slug)
      .concat(options.collectionSlugs ?? []),
  )
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const pagesDir = path.join(workspacePath, "src", "pages")

  await fs.mkdir(pagesDir, { recursive: true })

  const managedPaths = new Set<string>()

  for (const page of pages) {
    if (page.pageType === "collection") {
      continue
    }

    const relativePath = pageSlugToFilePath(page.slug, collectionSlugs, "static")
    managedPaths.add(relativePath)

    const filePath = path.join(workspacePath, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      generatePageContent(page, relativePath, { collectionSlugs }),
      "utf8",
    )

    if (collectionSlugs.has(page.slug) && !isHomeSlug(page.slug)) {
      const flatPath = path.join(pagesDir, `${page.slug}.astro`)
      try {
        await fs.unlink(flatPath)
      } catch {
        // flat file may not exist
      }
    }
  }

  await cleanupOrphanPages(pagesDir, managedPaths, collectionSlugs)
}

export { filePathToPageSlug, pageSlugToFilePath }
