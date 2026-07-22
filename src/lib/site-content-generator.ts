import fs from "node:fs/promises"
import path from "node:path"
import type { DataFieldDefinition } from "./data-model.js"
import { getSiteWorkspacePath } from "./paths.js"
import { collectionEntryRouteFilePath, getImportPrefix, isHomeSlug } from "./site-routing.js"
import { generateBlocksMarkup, type GeneratedBlock } from "./site-page-generator.js"
import { getSiteSettingsImportPath, resolveSiteBindingsInValue } from "./content-binding.js"
import { getLayoutImportStatement, layoutToImportAlias, type SiteLayoutRef } from "./layout-routing.js"

export type CollectionEntryFile = {
  slug: string
  title: string
  excerpt: string | null
  body: string | null
  data: Record<string, unknown>
  status: string
  publishedAt: string | null
  updatedAt: string
}

export type CollectionFile = {
  slug: string
  name: string
  description: string | null
  fieldsSchema: DataFieldDefinition[]
  entries: CollectionEntryFile[]
}

export type PageDataFile = {
  slug: string
  name: string
  fieldsSchema: DataFieldDefinition[]
  fieldValues: Record<string, unknown>
}

function escapeFrontmatter(value: string) {
  return value.replace(/"/g, '\\"')
}

function generateMarkdownEntry(entry: CollectionEntryFile) {
  const dataYaml =
    Object.keys(entry.data).length > 0
      ? `data: ${JSON.stringify(entry.data)}\n`
      : ""

  return `---
title: "${escapeFrontmatter(entry.title)}"
slug: "${escapeFrontmatter(entry.slug)}"
status: "${entry.status}"
publishedAt: ${entry.publishedAt ? `"${entry.publishedAt}"` : "null"}
excerpt: "${escapeFrontmatter(entry.excerpt ?? "")}"
updatedAt: "${entry.updatedAt}"
${dataYaml}---

${entry.body ?? ""}
`
}

function generateCollectionEntryRouteContent(
  collectionSlug: string,
  relativeRoutePath: string,
  blocks: GeneratedBlock[] = [],
  layout: SiteLayoutRef = { slug: "default", name: "Default", isDefault: true },
) {
  const importPrefix = getImportPrefix(relativeRoutePath)
  const layoutImport = getLayoutImportStatement(relativeRoutePath, layout)
  const layoutAlias = layoutToImportAlias(layout)

  if (blocks.length > 0) {
    const { imports, body } = generateBlocksMarkup(blocks, relativeRoutePath, "entry")

    return `---
${layoutImport}
import collection from "${importPrefix}data/collections/${collectionSlug}.json"
${getSiteSettingsImportPath(relativeRoutePath)}
${imports ? `${imports}\n` : ""}
export function getStaticPaths() {
  return collection.entries
    .filter((entry) => entry.status === "published")
    .map((entry) => ({
      params: { slug: entry.slug },
      props: { entry },
    }))
}

const { entry } = Astro.props
---

<${layoutAlias} title={entry.title}>
${body || "  <!-- empty entry page -->"}
</${layoutAlias}>
`
  }

  return `---
${layoutImport}
import collection from "${importPrefix}data/collections/${collectionSlug}.json"
${getSiteSettingsImportPath(relativeRoutePath)}

export function getStaticPaths() {
  return collection.entries
    .filter((entry) => entry.status === "published")
    .map((entry) => ({
      params: { slug: entry.slug },
      props: { entry },
    }))
}

const { entry } = Astro.props
---

<${layoutAlias} title={entry.title}>
  <main class="container py-8">
    <article>
      <h1 class="text-3xl font-semibold">{entry.title}</h1>
      {entry.excerpt ? <p class="mt-4 text-lg text-muted-foreground">{entry.excerpt}</p> : null}
      {entry.body ? <div class="mt-8 whitespace-pre-wrap">{entry.body}</div> : null}
      {entry.data && Object.keys(entry.data).length > 0 ? (
        <dl class="mt-8 grid gap-3">
          {Object.entries(entry.data).map(([key, value]) => (
            <div key={key}>
              <dt class="text-sm font-medium capitalize">{key.replace(/_/g, " ")}</dt>
              <dd class="text-muted-foreground">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  </main>
</${layoutAlias}>
`
}

function prepareCollectionEntryForGeneration(
  entry: CollectionEntryFile,
  globalFieldValues: Record<string, unknown>,
): CollectionEntryFile {
  return {
    ...entry,
    title: String(resolveSiteBindingsInValue(entry.title, globalFieldValues) ?? ""),
    excerpt:
      entry.excerpt === null
        ? null
        : String(resolveSiteBindingsInValue(entry.excerpt, globalFieldValues) ?? ""),
    body:
      entry.body === null ? null : String(resolveSiteBindingsInValue(entry.body, globalFieldValues) ?? ""),
    data: resolveSiteBindingsInValue(entry.data, globalFieldValues) as Record<string, unknown>,
  }
}

export async function generateSiteCollections(
  workspacesDir: string,
  siteId: number,
  collections: CollectionFile[],
  options: {
    entryBlocksBySlug?: Record<string, GeneratedBlock[]>
    entryLayoutBySlug?: Record<string, SiteLayoutRef>
    globalFieldValues?: Record<string, unknown>
  } = {},
) {
  const globalFieldValues = options.globalFieldValues ?? {}
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const dataDir = path.join(workspacePath, "src", "data", "collections")
  const contentRoot = path.join(workspacePath, "src", "content")
  const pagesDir = path.join(workspacePath, "src", "pages")

  await fs.mkdir(dataDir, { recursive: true })

  const activeSlugs = new Set(collections.map((collection) => collection.slug))

  try {
    const existingJsonFiles = await fs.readdir(dataDir)
    for (const file of existingJsonFiles) {
      if (!file.endsWith(".json")) {
        continue
      }

      const slug = file.replace(/\.json$/, "")
      if (!activeSlugs.has(slug)) {
        await fs.unlink(path.join(dataDir, file))
      }
    }
  } catch {
    // data directory may not exist yet
  }

  try {
    const existingContentDirs = await fs.readdir(contentRoot)
    for (const dir of existingContentDirs) {
      if (!activeSlugs.has(dir)) {
        await fs.rm(path.join(contentRoot, dir), { recursive: true, force: true })
      }
    }
  } catch {
    // content root may not exist yet
  }

  try {
    const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true })
    for (const entry of pageEntries) {
      if (!entry.isDirectory()) {
        continue
      }

      if (entry.name === "preview") {
        continue
      }

      if (!activeSlugs.has(entry.name)) {
        await fs.rm(path.join(pagesDir, entry.name), { recursive: true, force: true })
      }
    }
  } catch {
    // pages directory may not exist yet
  }

  for (const collection of collections) {
    const entries = collection.entries.map((entry) =>
      prepareCollectionEntryForGeneration(entry, globalFieldValues),
    )

    await fs.writeFile(
      path.join(dataDir, `${collection.slug}.json`),
      `${JSON.stringify(
        {
          slug: collection.slug,
          name: collection.name,
          description: collection.description,
          fieldsSchema: collection.fieldsSchema,
          entries,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const collectionContentDir = path.join(contentRoot, collection.slug)
    await fs.rm(collectionContentDir, { recursive: true, force: true })

    if (entries.length > 0) {
      await fs.mkdir(collectionContentDir, { recursive: true })

      for (const entry of entries) {
        await fs.writeFile(
          path.join(collectionContentDir, `${entry.slug}.md`),
          generateMarkdownEntry(entry),
          "utf8",
        )
      }
    }

    const relativeRoutePath = collectionEntryRouteFilePath(collection.slug)
    const routeFilePath = path.join(workspacePath, relativeRoutePath)
    await fs.mkdir(path.dirname(routeFilePath), { recursive: true })
    await fs.writeFile(
      routeFilePath,
      generateCollectionEntryRouteContent(
        collection.slug,
        relativeRoutePath,
        options.entryBlocksBySlug?.[collection.slug] ?? [],
        options.entryLayoutBySlug?.[collection.slug] ?? {
          slug: "default",
          name: "Default",
          isDefault: true,
        },
      ),
      "utf8",
    )
  }
}

export async function generateSitePageData(
  workspacesDir: string,
  siteId: number,
  pages: PageDataFile[],
  options: {
    globalFieldValues?: Record<string, unknown>
  } = {},
) {
  const globalFieldValues = options.globalFieldValues ?? {}
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const dataDir = path.join(workspacePath, "src", "data", "pages")

  await fs.mkdir(dataDir, { recursive: true })

  const activeSlugs = new Set(pages.map((page) => (isHomeSlug(page.slug) ? "home" : page.slug)))

  try {
    const existingJsonFiles = await fs.readdir(dataDir)
    for (const file of existingJsonFiles) {
      if (!file.endsWith(".json")) {
        continue
      }

      const slug = file.replace(/\.json$/, "")
      if (!activeSlugs.has(slug)) {
        await fs.unlink(path.join(dataDir, file))
      }
    }
  } catch {
    // pages data directory may not exist yet
  }

  for (const page of pages) {
    const fileSlug = isHomeSlug(page.slug) ? "home" : page.slug
    const output = {
      ...page,
      fieldValues: resolveSiteBindingsInValue(page.fieldValues, globalFieldValues) as Record<
        string,
        unknown
      >,
    }

    await fs.writeFile(
      path.join(dataDir, `${fileSlug}.json`),
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    )
  }
}

export type SiteSettingsFile = {
  name: string
  fieldsSchema: DataFieldDefinition[]
  fieldValues: Record<string, unknown>
}

export async function generateSiteGlobalData(
  workspacesDir: string,
  siteId: number,
  global: SiteSettingsFile | null,
) {
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const filePath = path.join(workspacePath, "src", "data", "site-settings.json")

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      global ?? {
        name: "",
        fieldsSchema: [],
        fieldValues: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

export type FormDefinitionFile = {
  slug: string
  name: string
  description: string | null
  fieldsSchema: DataFieldDefinition[]
  settings: {
    successMessage: string
    redirectUrl: string
  }
}

export async function generateSiteForms(
  workspacesDir: string,
  siteId: number,
  forms: FormDefinitionFile[],
  apiBase: string,
) {
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const dataDir = path.join(workspacePath, "src", "data", "forms")
  await fs.mkdir(dataDir, { recursive: true })

  const normalizedApiBase = apiBase.replace(/\/$/, "")
  const activeSlugs = new Set<string>()

  for (const form of forms) {
    activeSlugs.add(form.slug)
    const submitPath = `/api/public/sites/${siteId}/forms/${form.slug}/submit`
    const output = {
      ...form,
      submitPath,
      submitUrl: `${normalizedApiBase}${submitPath}`,
    }

    await fs.writeFile(
      path.join(dataDir, `${form.slug}.json`),
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    )
  }

  const index = {
    siteId,
    apiBase: normalizedApiBase,
    forms: forms.map((form) => {
      const submitPath = `/api/public/sites/${siteId}/forms/${form.slug}/submit`
      return {
        slug: form.slug,
        name: form.name,
        submitPath,
        submitUrl: `${normalizedApiBase}${submitPath}`,
      }
    }),
  }

  await fs.writeFile(path.join(dataDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8")

  try {
    const files = await fs.readdir(dataDir)
    for (const file of files) {
      if (file === "index.json" || !file.endsWith(".json")) {
        continue
      }

      const slug = file.replace(/\.json$/, "")
      if (!activeSlugs.has(slug)) {
        await fs.unlink(path.join(dataDir, file))
      }
    }
  } catch {
    // forms data directory may not exist yet
  }
}
