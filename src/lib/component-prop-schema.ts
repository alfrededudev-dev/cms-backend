import { IMAGE_PLACEHOLDER_URL } from "./image-placeholder.js"
import { normalizeFormFieldsFromProp } from "./data-model.js"

export const COMPONENT_PROPS_SCHEMA_KEY = "_schema"
export const COMPONENT_PROPS_SCHEMAS_KEY = "_schemas"

export const componentPropTypes = [
  "text",
  "boolean",
  "textarea",
  "number",
  "date",
  "image",
  "richText",
  "link",
  "repeater",
  "component",
  "dynamicZone",
  "siteForm",
  "formFields",
] as const

export type ComponentPropType = (typeof componentPropTypes)[number]

export type NestedComponentInstance = {
  id: string
  componentSlug: string
  variantSlug: string
  props: Record<string, unknown>
}

export type ComponentPropDefinition = {
  type: ComponentPropType
  label: string
  fields?: RepeaterFieldsSchema
  components?: string[]
}

export type RepeaterFieldDefinition = {
  type: Exclude<ComponentPropType, "repeater" | "component" | "dynamicZone">
  label: string
}

export type RepeaterFieldsSchema = Record<string, RepeaterFieldDefinition>

export type ComponentPropsSchema = Record<string, ComponentPropDefinition>

export type ComponentLinkValue = {
  title: string
  href: string
  target: string
}

export type ComponentImageValue = {
  src: string
  alt: string
}

export const componentLinkTargets = [
  { value: "_self", label: "Same window (_self)" },
  { value: "_blank", label: "New tab (_blank)" },
  { value: "_parent", label: "Parent frame (_parent)" },
  { value: "_top", label: "Top frame (_top)" },
] as const

export function createNestedComponentId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeNestedComponentInstance(value: unknown): NestedComponentInstance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const componentSlug = String(record.componentSlug ?? "").trim()
  const variantSlug = String(record.variantSlug ?? "default").trim()

  if (!componentSlug) {
    return null
  }

  return {
    id: String(record.id ?? createNestedComponentId()),
    componentSlug,
    variantSlug: variantSlug || "default",
    props:
      record.props && typeof record.props === "object" && !Array.isArray(record.props)
        ? (record.props as Record<string, unknown>)
        : {},
  }
}

export function normalizeComponentPropValue(value: unknown): NestedComponentInstance | null {
  return normalizeNestedComponentInstance(value)
}

export function normalizeDynamicZoneValue(value: unknown): NestedComponentInstance[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeNestedComponentInstance(item))
    .filter((item): item is NestedComponentInstance => item !== null)
}

export function collectComponentSlugsFromValue(value: unknown): string[] {
  const slugs = new Set<string>()

  function walk(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    if (!node || typeof node !== "object") {
      return
    }

    const record = node as Record<string, unknown>

    if (
      typeof record.componentSlug === "string" &&
      record.componentSlug.trim() &&
      typeof record.variantSlug === "string"
    ) {
      slugs.add(record.componentSlug)
    }

    for (const child of Object.values(record)) {
      walk(child)
    }
  }

  walk(value)
  return [...slugs]
}

export function collectComponentSlugsFromProps(
  props: Record<string, unknown>,
  schema: ComponentPropsSchema,
) {
  const slugs = new Set<string>()

  for (const [key, definition] of Object.entries(schema)) {
    const type = normalizePropType(definition.type)

    if (type === "component" || type === "dynamicZone") {
      for (const slug of collectComponentSlugsFromValue(props[key])) {
        slugs.add(slug)
      }
    }
  }

  return [...slugs]
}

export function defaultLinkValue(): ComponentLinkValue {
  return { title: "", href: "", target: "_self" }
}


export function defaultImageValue(): ComponentImageValue {
  return { src: IMAGE_PLACEHOLDER_URL, alt: "" }
}

export function normalizeImageValue(value: unknown): ComponentImageValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const src = String(record.src ?? "").trim()

    return {
      src: src || IMAGE_PLACEHOLDER_URL,
      alt: String(record.alt ?? ""),
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    return { src: trimmed || IMAGE_PLACEHOLDER_URL, alt: "" }
  }

  return defaultImageValue()
}

export function normalizeLinkValue(value: unknown): ComponentLinkValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const rawTarget = String(record.target ?? "_self")
    const target = componentLinkTargets.some((item) => item.value === rawTarget) ? rawTarget : "_self"

    return {
      title: String(record.title ?? ""),
      href: String(record.href ?? record.url ?? record.link ?? ""),
      target,
    }
  }

  if (typeof value === "string" && value.trim()) {
    return { title: "", href: value, target: "_self" }
  }

  return defaultLinkValue()
}

export function defaultRepeaterFields(): RepeaterFieldsSchema {
  return {
    title: { type: "text", label: "Title" },
  }
}

export function normalizeRepeaterFieldsSchema(fields: RepeaterFieldsSchema): RepeaterFieldsSchema {
  return Object.fromEntries(
    Object.entries(fields).map(([key, definition]) => [
      key,
      {
        label: definition.label,
        type: normalizePropType(definition.type) as RepeaterFieldDefinition["type"],
      },
    ]),
  )
}

export function createEmptyRepeaterItem(fields: RepeaterFieldsSchema) {
  return createEmptyPreviewProps(fields as ComponentPropsSchema)
}

export function normalizeRepeaterValue(value: unknown, fields: RepeaterFieldsSchema) {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedFields = normalizeRepeaterFieldsSchema(fields)

  return value.map((item) =>
    mergePreviewPropsWithSchema(
      normalizedFields as ComponentPropsSchema,
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {},
    ),
  )
}

export const DEFAULT_PROPS_SCHEMA: ComponentPropsSchema = {
  title: { type: "text", label: "Title" },
  image: { type: "image", label: "Image" },
  body: { type: "richText", label: "Body" },
}

export function normalizePropType(type: string): ComponentPropType {
  if (type === "media") {
    return "image"
  }

  if ((componentPropTypes as readonly string[]).includes(type)) {
    return type as ComponentPropType
  }

  return "text"
}

export function normalizePropsSchema(
  schema: Record<
    string,
    {
      type: string
      label: string
      fields?: Record<string, { type: string; label: string }>
      components?: string[]
    }
  >,
): ComponentPropsSchema {
  return Object.fromEntries(
    Object.entries(schema).map(([key, definition]) => {
      const type = normalizePropType(definition.type)

      if (type === "repeater") {
        return [
          key,
          {
            label: definition.label,
            type,
            fields: normalizeRepeaterFieldsSchema(
              (definition.fields ?? defaultRepeaterFields()) as RepeaterFieldsSchema,
            ),
          },
        ]
      }

      if (type === "component" || type === "dynamicZone") {
        return [
          key,
          {
            label: definition.label,
            type,
            components: Array.isArray(definition.components)
              ? definition.components.map((item) => String(item).trim()).filter(Boolean)
              : [],
          },
        ]
      }

      return [
        key,
        {
          label: definition.label,
          type,
        },
      ]
    }),
  )
}

export function defaultValueForPropType(type: ComponentPropType) {
  switch (type) {
    case "boolean":
      return false
    case "number":
      return ""
    case "link":
      return defaultLinkValue()
    case "image":
      return defaultImageValue()
    case "repeater":
      return []
    case "component":
      return null
    case "dynamicZone":
      return []
    case "formFields":
      return []
    default:
      return ""
  }
}

export function humanizePropKey(key: string) {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function inferPropTypeFromKey(key: string): ComponentPropType {
  const slug = key.toLowerCase()

  if (slug === "imagealt" || slug === "image_alt" || slug.endsWith("_alt")) {
    return "text"
  }

  if (
    slug.includes("image") ||
    slug.includes("photo") ||
    slug.includes("media") ||
    slug.includes("cover") ||
    slug.includes("thumbnail") ||
    slug.includes("avatar")
  ) {
    return "image"
  }

  if (
    slug.startsWith("is_") ||
    slug.startsWith("has_") ||
    slug.endsWith("_enabled") ||
    slug === "enabled" ||
    slug === "visible"
  ) {
    return "boolean"
  }

  if (slug.includes("date") || slug.endsWith("_at") || slug.endsWith("_on")) {
    return "date"
  }

  if (
    slug.includes("count") ||
    slug.includes("amount") ||
    slug.includes("price") ||
    slug.includes("number") ||
    slug.includes("quantity") ||
    slug.includes("rating")
  ) {
    return "number"
  }

  if (
    slug.includes("richtext") ||
    slug.includes("rich_text") ||
    slug.includes("wysiwyg") ||
    slug === "body"
  ) {
    return "richText"
  }

  if (slug === "link" || slug.endsWith("_link") || slug === "cta" || slug.endsWith("_cta")) {
    return "link"
  }

  if (
    slug === "items" ||
    slug.endsWith("_items") ||
    slug === "steps" ||
    slug.endsWith("_steps") ||
    slug.includes("repeater")
  ) {
    return "repeater"
  }

  if (
    slug.includes("description") ||
    slug.includes("excerpt") ||
    slug.includes("content") ||
    slug.includes("summary")
  ) {
    return "textarea"
  }

  return "text"
}

export function inferPropsSchema(previewProps: Record<string, unknown>): ComponentPropsSchema {
  return Object.fromEntries(
    Object.entries(previewProps).map(([key, value]) => {
      const type = Array.isArray(value) ? ("repeater" as const) : inferPropTypeFromKey(key)

      if (type === "repeater") {
        return [
          key,
          {
            type,
            label: humanizePropKey(key),
            fields: inferRepeaterFieldsFromArrayValue(value),
          },
        ]
      }

      return [
        key,
        {
          type,
          label: humanizePropKey(key),
        },
      ]
    }),
  )
}

function inferRepeaterFieldsFromArrayValue(value: unknown): RepeaterFieldsSchema {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultRepeaterFields()
  }

  const firstItem = value[0]
  if (!firstItem || typeof firstItem !== "object" || Array.isArray(firstItem)) {
    return defaultRepeaterFields()
  }

  const fields = Object.fromEntries(
    Object.entries(firstItem as Record<string, unknown>).map(([fieldKey]) => [
      fieldKey,
      {
        type: inferPropTypeFromKey(fieldKey),
        label: humanizePropKey(fieldKey),
      },
    ]),
  ) as RepeaterFieldsSchema

  return Object.keys(fields).length > 0 ? fields : defaultRepeaterFields()
}

export function createEmptyPreviewProps(schema: ComponentPropsSchema) {
  const values: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(schema)) {
    values[key] = defaultValueForPropType(normalizePropType(definition.type))
  }

  return values
}

export function mergePreviewPropsWithSchema(
  schema: ComponentPropsSchema,
  previewProps: Record<string, unknown>,
) {
  const normalizedSchema = normalizePropsSchema(schema)
  const merged = {
    ...createEmptyPreviewProps(normalizedSchema),
    ...previewProps,
  }

  if (normalizedSchema.image && normalizePropType(normalizedSchema.image.type) === "image") {
    const legacyAlt = previewProps.imageAlt ?? previewProps.image_alt
    const image = normalizeImageValue(merged.image)

    if (legacyAlt && !image.alt) {
      image.alt = String(legacyAlt)
    }

    merged.image = image
  }

  for (const [key, definition] of Object.entries(normalizedSchema)) {
    const type = normalizePropType(definition.type)

    if (type === "boolean") {
      merged[key] = merged[key] === true || merged[key] === "true"
      continue
    }

    if (type === "number" && merged[key] !== "" && merged[key] !== null && merged[key] !== undefined) {
      const numeric = typeof merged[key] === "number" ? merged[key] : Number(merged[key])
      merged[key] = Number.isNaN(numeric) ? "" : numeric
      continue
    }

    if (type === "link") {
      merged[key] = normalizeLinkValue(merged[key])
      continue
    }

    if (type === "image") {
      merged[key] = normalizeImageValue(merged[key])
      continue
    }

    if (type === "repeater") {
      merged[key] = normalizeRepeaterValue(merged[key], definition.fields ?? defaultRepeaterFields())
      continue
    }

    if (type === "component") {
      merged[key] = normalizeComponentPropValue(merged[key])
      continue
    }

    if (type === "dynamicZone") {
      merged[key] = normalizeDynamicZoneValue(merged[key])
      continue
    }

    if (type === "formFields") {
      merged[key] = normalizeFormFieldsFromProp(merged[key])
    }
  }

  return merged
}

export function isPreviewSchemaEntry(key: string) {
  return key === COMPONENT_PROPS_SCHEMA_KEY || key === COMPONENT_PROPS_SCHEMAS_KEY
}
