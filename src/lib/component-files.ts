import fs from "node:fs/promises"
import path from "node:path"
import {
  COMPONENT_PROPS_SCHEMA_KEY,
  COMPONENT_PROPS_SCHEMAS_KEY,
  inferPropsSchema,
  mergePreviewPropsWithSchema,
  normalizePropsSchema,
  type ComponentPropsSchema,
} from "./component-prop-schema.js"
import { DEFAULT_COMPONENT_KIND, type ComponentKind } from "./component-kind.js"
import {
  COMPONENT_KIND_META_KEY,
  assertLayoutComponentHasSlot,
} from "./layout-component.js"
import {
  DEFAULT_PROPS_SCHEMA,
  getComponentKindDefaults,
} from "./component-templates.js"
import { syncPropsToAstroFrontmatter } from "./component-code-sync.js"
import {
  getComponentDir,
  getPreviewJsonPath,
  getVariantFilePath,
} from "./paths.js"
import { variantNameToSlug, variantSlugToFileName } from "./slug.js"

type PreviewJson = Record<string, unknown> & {
  [COMPONENT_PROPS_SCHEMA_KEY]?: ComponentPropsSchema
  [COMPONENT_PROPS_SCHEMAS_KEY]?: Record<string, ComponentPropsSchema>
}

export function resolveVariantPropsSchema(
  preview: PreviewJson,
  variantSlug: string,
): ComponentPropsSchema {
  const perVariant = preview[COMPONENT_PROPS_SCHEMAS_KEY]

  if (perVariant?.[variantSlug]) {
    return normalizePropsSchema(perVariant[variantSlug])
  }

  if (preview[COMPONENT_PROPS_SCHEMA_KEY]) {
    return normalizePropsSchema(preview[COMPONENT_PROPS_SCHEMA_KEY] as ComponentPropsSchema)
  }

  const raw = preview[variantSlug]

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return inferPropsSchema(raw as Record<string, unknown>)
  }

  return DEFAULT_PROPS_SCHEMA
}

export async function readVariantPropsSchema(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
): Promise<ComponentPropsSchema> {
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  return resolveVariantPropsSchema(preview, variantSlug)
}

export async function readComponentPropsSchema(
  componentLibraryDir: string,
  componentSlug: string,
): Promise<ComponentPropsSchema> {
  const files = await listVariantFiles(componentLibraryDir, componentSlug)
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const firstSlug = files.sort((left, right) => left.localeCompare(right))[0]

  if (firstSlug) {
    return resolveVariantPropsSchema(preview, variantFileNameToSlug(firstSlug))
  }

  if (preview[COMPONENT_PROPS_SCHEMA_KEY]) {
    return normalizePropsSchema(preview[COMPONENT_PROPS_SCHEMA_KEY] as ComponentPropsSchema)
  }

  return DEFAULT_PROPS_SCHEMA
}

export async function updateVariantPropsSchema(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
  schema: ComponentPropsSchema,
) {
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const normalizedSchema = normalizePropsSchema(schema)
  const schemas = {
    ...(preview[COMPONENT_PROPS_SCHEMAS_KEY] ?? {}),
  }

  if (preview[COMPONENT_PROPS_SCHEMA_KEY] && Object.keys(schemas).length === 0) {
    const legacySchema = normalizePropsSchema(
      preview[COMPONENT_PROPS_SCHEMA_KEY] as ComponentPropsSchema,
    )
    const variantSlugs = (await listComponentVariants(componentLibraryDir, componentSlug)).map(
      (variant) => variant.slug,
    )

    for (const slug of variantSlugs) {
      schemas[slug] = legacySchema
    }
  }

  schemas[variantSlug] = normalizedSchema
  preview[COMPONENT_PROPS_SCHEMAS_KEY] = schemas
  delete preview[COMPONENT_PROPS_SCHEMA_KEY]
  preview[variantSlug] = getVariantPreviewProps(preview, variantSlug, normalizedSchema)
  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

/** @deprecated Use updateVariantPropsSchema — kept for internal migration only */
export async function updateComponentPropsSchema(
  componentLibraryDir: string,
  componentSlug: string,
  schema: ComponentPropsSchema,
) {
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const normalizedSchema = normalizePropsSchema(schema)
  preview[COMPONENT_PROPS_SCHEMA_KEY] = normalizedSchema

  const variantSlugs = (await listComponentVariants(componentLibraryDir, componentSlug)).map(
    (variant) => variant.slug,
  )

  for (const variantSlug of variantSlugs) {
    preview[variantSlug] = getVariantPreviewProps(preview, variantSlug, normalizedSchema)
  }

  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

export async function syncComponentPropsToCode(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug?: string,
) {
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const variants = await listComponentVariants(componentLibraryDir, componentSlug)
  const targets = variantSlug
    ? variants.filter((variant) => variant.slug === variantSlug)
    : variants

  for (const variant of targets) {
    const schema = resolveVariantPropsSchema(preview, variant.slug)
    const variantProps = getVariantPreviewProps(preview, variant.slug, schema)

    try {
      const code = await readVariantCode(componentLibraryDir, componentSlug, variant.slug)
      const syncedCode = syncPropsToAstroFrontmatter(code, schema, variantProps)

      if (syncedCode !== code) {
        await writeVariantCode(componentLibraryDir, componentSlug, variant.slug, syncedCode)
      }
    } catch {
      // variant file may not exist yet
    }
  }
}

export function getVariantPreviewProps(
  preview: PreviewJson,
  variantSlug: string,
  schema: ComponentPropsSchema,
) {
  const raw = preview[variantSlug] ?? {}
  return mergePreviewPropsWithSchema(schema, raw as Record<string, unknown>)
}

export async function readPreviewJson(componentLibraryDir: string, componentSlug: string) {
  const previewPath = getPreviewJsonPath(componentLibraryDir, componentSlug)

  try {
    const content = await fs.readFile(previewPath, "utf8")
    return JSON.parse(content) as PreviewJson
  } catch {
    return {}
  }
}

async function writePreviewJson(
  componentLibraryDir: string,
  componentSlug: string,
  data: PreviewJson,
) {
  const previewPath = getPreviewJsonPath(componentLibraryDir, componentSlug)
  await fs.mkdir(path.dirname(previewPath), { recursive: true })
  await fs.writeFile(previewPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

export async function readVariantCode(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
) {
  const filePath = getVariantFilePath(componentLibraryDir, componentSlug, variantSlug)
  return fs.readFile(filePath, "utf8")
}

export async function writeVariantCode(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
  code: string,
) {
  const filePath = getVariantFilePath(componentLibraryDir, componentSlug, variantSlug)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, code, "utf8")
}

export async function createComponentWorkspace(
  componentLibraryDir: string,
  componentSlug: string,
  initialVariantSlug: string,
  kind: ComponentKind = DEFAULT_COMPONENT_KIND,
  previewProps?: Record<string, unknown>,
) {
  const defaults = getComponentKindDefaults(kind)
  const componentDir = getComponentDir(componentLibraryDir, componentSlug)
  await fs.mkdir(componentDir, { recursive: true })

  await writeVariantCode(
    componentLibraryDir,
    componentSlug,
    initialVariantSlug,
    defaults.template,
  )

  await writePreviewJson(componentLibraryDir, componentSlug, {
    [COMPONENT_KIND_META_KEY]: kind,
    [COMPONENT_PROPS_SCHEMAS_KEY]: {
      [initialVariantSlug]: defaults.propsSchema,
    },
    [initialVariantSlug]: previewProps ?? defaults.previewProps,
  })
}

export async function addVariantWorkspace(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
  previewProps?: Record<string, unknown>,
  code?: string,
  kind: ComponentKind = DEFAULT_COMPONENT_KIND,
  propsSchema?: ComponentPropsSchema,
) {
  const defaults = getComponentKindDefaults(kind)
  const resolvedCode = code ?? defaults.template
  const resolvedPreviewProps = previewProps ?? defaults.previewProps

  await writeVariantCode(componentLibraryDir, componentSlug, variantSlug, resolvedCode)

  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const resolvedSchema = normalizePropsSchema(propsSchema ?? defaults.propsSchema)
  const schemas = {
    ...(preview[COMPONENT_PROPS_SCHEMAS_KEY] ?? {}),
  }

  schemas[variantSlug] = resolvedSchema
  preview[COMPONENT_PROPS_SCHEMAS_KEY] = schemas
  delete preview[COMPONENT_PROPS_SCHEMA_KEY]
  preview[variantSlug] = mergePreviewPropsWithSchema(resolvedSchema, resolvedPreviewProps)
  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

export async function updateVariantPreviewProps(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
  previewProps: Record<string, unknown>,
) {
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  const schema = resolveVariantPropsSchema(preview, variantSlug)
  preview[variantSlug] = mergePreviewPropsWithSchema(schema, previewProps)
  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

export async function deleteVariantWorkspace(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
) {
  const filePath = getVariantFilePath(componentLibraryDir, componentSlug, variantSlug)

  try {
    await fs.unlink(filePath)
  } catch {
    // ignore missing file
  }

  const preview = await readPreviewJson(componentLibraryDir, componentSlug)
  delete preview[variantSlug]

  const schemas = preview[COMPONENT_PROPS_SCHEMAS_KEY]

  if (schemas?.[variantSlug]) {
    delete schemas[variantSlug]
  }

  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

export async function deleteComponentWorkspace(componentLibraryDir: string, componentSlug: string) {
  const componentDir = getComponentDir(componentLibraryDir, componentSlug)
  await fs.rm(componentDir, { recursive: true, force: true })
}

export async function listVariantFiles(componentLibraryDir: string, componentSlug: string) {
  const componentDir = getComponentDir(componentLibraryDir, componentSlug)

  try {
    const entries = await fs.readdir(componentDir)
    return entries.filter((entry) => entry.endsWith(".astro"))
  } catch {
    return []
  }
}

export function humanizeVariantSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export type FilesystemComponentVariant = {
  slug: string
  name: string
  previewProps: Record<string, unknown>
  propsSchema: ComponentPropsSchema
  sortOrder: number
}

export async function listComponentVariants(
  componentLibraryDir: string,
  componentSlug: string,
): Promise<FilesystemComponentVariant[]> {
  const files = await listVariantFiles(componentLibraryDir, componentSlug)
  const preview = await readPreviewJson(componentLibraryDir, componentSlug)

  return files
    .sort((left, right) => left.localeCompare(right))
    .map((fileName, index) => {
      const slug = variantFileNameToSlug(fileName)
      const schema = resolveVariantPropsSchema(preview, slug)

      return {
        slug,
        name: humanizeVariantSlug(slug),
        previewProps: getVariantPreviewProps(preview, slug, schema),
        propsSchema: schema,
        sortOrder: index,
      }
    })
}

export async function hasComponentVariant(
  componentLibraryDir: string,
  componentSlug: string,
  variantSlug: string,
) {
  const filePath = getVariantFilePath(componentLibraryDir, componentSlug, variantSlug)

  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureUniqueVariantSlug(
  componentLibraryDir: string,
  componentSlug: string,
  name: string,
) {
  const baseSlug = variantNameToSlug(name) || "variant"
  const existing = await listComponentVariants(componentLibraryDir, componentSlug)
  let slug = baseSlug
  let suffix = 2

  while (existing.some((variant) => variant.slug === slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return slug
}

export async function renameVariantWorkspace(
  componentLibraryDir: string,
  componentSlug: string,
  fromSlug: string,
  toSlug: string,
) {
  if (fromSlug === toSlug) {
    return
  }

  const fromPath = getVariantFilePath(componentLibraryDir, componentSlug, fromSlug)
  const toPath = getVariantFilePath(componentLibraryDir, componentSlug, toSlug)
  await fs.rename(fromPath, toPath)

  const preview = await readPreviewJson(componentLibraryDir, componentSlug)

  if (preview[fromSlug] !== undefined) {
    preview[toSlug] = preview[fromSlug]
    delete preview[fromSlug]
  }

  const schemas = preview[COMPONENT_PROPS_SCHEMAS_KEY]

  if (schemas?.[fromSlug]) {
    schemas[toSlug] = schemas[fromSlug]
    delete schemas[fromSlug]
  }

  await writePreviewJson(componentLibraryDir, componentSlug, preview)
}

export function variantFileNameToSlug(fileName: string) {
  const base = fileName.replace(/\.astro$/, "")
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
}

export { variantSlugToFileName }
