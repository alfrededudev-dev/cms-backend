import { getImportPrefix } from "./site-routing.js"

export type ContentBindingContext = "single" | "entry"

export type SiteFieldPathSegment = string | number

const FIELD_KEY = "[a-zA-Z_][\\w]*"
const FULL_BINDING_RE = new RegExp(`^\\{(${FIELD_KEY})\\}$`)
const PARTIAL_BINDING_RE = new RegExp(`\\{(${FIELD_KEY})\\}`, "g")
const SITE_BINDING_PATTERN = /\{site\.([^}]+)\}/g
const SITE_BINDING_FULL_PATTERN = /^\{site\.([^}]+)\}$/

export function parseSiteFieldPath(path: string): SiteFieldPathSegment[] | null {
  const trimmed = path.trim()
  if (!trimmed) {
    return null
  }

  const segments: SiteFieldPathSegment[] = []
  const identifierMatch = trimmed.match(/^[a-zA-Z_]\w*/)
  if (!identifierMatch) {
    return null
  }

  segments.push(identifierMatch[0])
  let index = identifierMatch[0].length

  while (index < trimmed.length) {
    const rest = trimmed.slice(index)

    if (rest.startsWith(".")) {
      index += 1
      const propertyMatch = rest.slice(1).match(/^[a-zA-Z_]\w*/)
      if (!propertyMatch) {
        return null
      }

      segments.push(propertyMatch[0])
      index += propertyMatch[0].length
      continue
    }

    if (rest.startsWith("[")) {
      const indexMatch = rest.match(/^\[(\d+)\]/)
      if (!indexMatch) {
        return null
      }

      segments.push(Number(indexMatch[1]))
      index += indexMatch[0].length
      continue
    }

    return null
  }

  return segments
}

export function resolveSiteFieldPath(
  globalFieldValues: Record<string, unknown>,
  path: string,
): unknown {
  const segments = parseSiteFieldPath(path)
  if (!segments) {
    return undefined
  }

  let current: unknown = globalFieldValues

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined
      }

      current = current[segment]
      continue
    }

    if (typeof current !== "object" || Array.isArray(current)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

export function getSiteFieldExpression(fieldPath: string) {
  const segments = parseSiteFieldPath(fieldPath)
  if (!segments || segments.length === 0) {
    return "undefined"
  }

  let expression = "siteSettings.fieldValues"

  for (const segment of segments) {
    if (typeof segment === "number") {
      expression += `?.[${segment}]`
      continue
    }

    expression += `?.${segment}`
  }

  return expression
}

export function formatSiteFieldBindingPath(path: string) {
  return `{site.${path}}`
}

function formatResolvedSiteFieldValue(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return JSON.stringify(value)
}

function containsSiteBinding(value: string) {
  SITE_BINDING_PATTERN.lastIndex = 0
  return SITE_BINDING_PATTERN.test(value)
}

export function isContentFieldBinding(value: unknown): value is string {
  if (typeof value !== "string") {
    return false
  }

  return containsSiteBinding(value) || PARTIAL_BINDING_RE.test(value)
}

export function getContentFieldBindingKey(value: string): string | null {
  const siteMatch = value.trim().match(SITE_BINDING_FULL_PATTERN)
  if (siteMatch) {
    const path = siteMatch[1]?.trim() ?? ""
    const segments = parseSiteFieldPath(path)
    return segments?.[0] && typeof segments[0] === "string" ? segments[0] : null
  }

  const match = value.trim().match(FULL_BINDING_RE)
  return match?.[1] ?? null
}

export function resolveSiteBindingsInString(
  value: string,
  globalFieldValues: Record<string, unknown>,
) {
  SITE_BINDING_PATTERN.lastIndex = 0

  return value.replace(SITE_BINDING_PATTERN, (match, rawPath: string) => {
    const path = rawPath.trim()
    if (!parseSiteFieldPath(path)) {
      return match
    }

    return formatResolvedSiteFieldValue(resolveSiteFieldPath(globalFieldValues, path))
  })
}

export function resolveSiteBindingsInValue(
  value: unknown,
  globalFieldValues: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    if (!containsSiteBinding(value)) {
      return value
    }

    return resolveSiteBindingsInString(value, globalFieldValues)
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveSiteBindingsInValue(item, globalFieldValues))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolveSiteBindingsInValue(nested, globalFieldValues),
      ]),
    )
  }

  return value
}

export function getFieldExpression(fieldKey: string, context: ContentBindingContext) {
  if (context === "single") {
    return `pageData.fieldValues?.${fieldKey}`
  }

  if (fieldKey === "title" || fieldKey === "excerpt" || fieldKey === "body") {
    return `(entry.data?.${fieldKey} ?? entry.${fieldKey})`
  }

  return `entry.data?.${fieldKey}`
}

function replaceBindingPlaceholders(value: string, context: ContentBindingContext | null) {
  SITE_BINDING_PATTERN.lastIndex = 0

  const withSiteBindings = value.replace(SITE_BINDING_PATTERN, (match, rawPath: string) => {
    const path = rawPath.trim()
    if (!parseSiteFieldPath(path)) {
      return match
    }

    return "${" + getSiteFieldExpression(path) + "}"
  })

  return withSiteBindings.replace(PARTIAL_BINDING_RE, (match, fieldKey: string) => {
    if (context) {
      return "${" + getFieldExpression(fieldKey, context) + "}"
    }

    return match
  })
}

export function serializeBoundPropValue(value: unknown, context: ContentBindingContext | null): string {
  if (typeof value === "string") {
    const trimmed = value.trim()
    const siteFullBinding = trimmed.match(SITE_BINDING_FULL_PATTERN)

    if (siteFullBinding) {
      const path = siteFullBinding[1]?.trim() ?? ""
      if (parseSiteFieldPath(path)) {
        return getSiteFieldExpression(path)
      }
    }

    if (context) {
      const fullBinding = trimmed.match(FULL_BINDING_RE)

      if (fullBinding) {
        return getFieldExpression(fullBinding[1]!, context)
      }
    }

    if (containsSiteBinding(value) || (context && PARTIAL_BINDING_RE.test(value))) {
      PARTIAL_BINDING_RE.lastIndex = 0

      const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$")

      return "`" + replaceBindingPlaceholders(escaped, context) + "`"
    }

    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeBoundPropValue(item, context)).join(", ")}]`
  }

  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      const safeKey = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
      return `${safeKey}: ${serializeBoundPropValue(nested, context)}`
    })

    return `{ ${parts.join(", ")} }`
  }

  return JSON.stringify(value)
}

export function serializeBoundProps(
  props: Record<string, unknown>,
  context: ContentBindingContext | null,
) {
  return Object.entries(props)
    .map(([key, value]) => `${key}={${serializeBoundPropValue(value, context)}}`)
    .join(" ")
}

export const SITE_SETTINGS_IMPORT = 'import siteSettings from "../data/site-settings.json"'

export function getSiteSettingsImportPath(relativeFilePath: string) {
  const prefix = getImportPrefix(relativeFilePath)
  return `import siteSettings from "${prefix}data/site-settings.json"`
}
