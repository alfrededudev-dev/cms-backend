import type { ComponentPropDefinition, ComponentPropType, ComponentPropsSchema, RepeaterFieldsSchema } from "./component-prop-schema.js"
import { IMAGE_PLACEHOLDER_URL } from "./image-placeholder.js"
import { normalizeFormFieldsFromProp } from "./data-model.js"
import {
  defaultRepeaterFields,
  defaultValueForPropType,
  mergePreviewPropsWithSchema,
  normalizeComponentPropValue,
  normalizeDynamicZoneValue,
  normalizeImageValue,
  normalizeLinkValue,
  normalizePropType,
  normalizeRepeaterFieldsSchema,
  normalizeRepeaterValue,
} from "./component-prop-schema.js"

const FORBIDDEN_IMPORT_PATTERNS = [/CmsImage\.astro/, /CmsLink\.astro/]

function propTypeToTs(type: ComponentPropType, fields?: RepeaterFieldsSchema): string {
  switch (type) {
    case "boolean":
      return "boolean"
    case "number":
      return "number"
    case "link":
      return "{ title?: string; href?: string; target?: string }"
    case "image":
      return "{ src?: string; alt?: string }"
    case "repeater": {
      const itemFields = normalizeRepeaterFieldsSchema(fields ?? defaultRepeaterFields())
      const inner = Object.entries(itemFields)
        .map(([fieldKey, definition]) => `${fieldKey}?: ${propTypeToTs(definition.type)}`)
        .join("; ")
      return `Array<{ ${inner} }>`
    }
    case "component":
      return "NestedComponentInstance | null"
    case "dynamicZone":
      return "NestedComponentInstance[]"
    case "formFields":
      return "FormFieldSchema[]"
    case "siteForm":
      return "string"
    default:
      return "string"
  }
}

function formatDefaultLiteral(
  type: ComponentPropType,
  value: unknown,
  definition?: ComponentPropDefinition,
): string {
  switch (type) {
    case "boolean":
      return value === true || value === "true" ? "true" : "false"
    case "number": {
      const numeric = typeof value === "number" ? value : Number(value)
      return Number.isFinite(numeric) ? String(numeric) : "0"
    }
    case "link": {
      const link = normalizeLinkValue(value)
      return `{ title: ${JSON.stringify(link.title)}, href: ${JSON.stringify(link.href)}, target: ${JSON.stringify(link.target)} }`
    }
    case "image": {
      const image = normalizeImageValue(value)
      return `{ src: ${JSON.stringify(image.src)}, alt: ${JSON.stringify(image.alt)} }`
    }
    case "repeater": {
      const fields = definition?.fields ?? defaultRepeaterFields()
      const items = normalizeRepeaterValue(value, fields)
      return JSON.stringify(items)
    }
    case "component": {
      const item = normalizeComponentPropValue(value)
      return item ? JSON.stringify(item) : "null"
    }
    case "dynamicZone":
      return JSON.stringify(normalizeDynamicZoneValue(value))
    case "formFields":
      return JSON.stringify(normalizeFormFieldsFromProp(value))
    case "siteForm":
      return JSON.stringify(typeof value === "string" ? value : String(value ?? ""))
    default:
      if (value && typeof value === "object") {
        return JSON.stringify(value)
      }

      return JSON.stringify(typeof value === "string" ? value : String(value ?? ""))
  }
}

const FORM_FRONTMATTER_HELPERS = `function findField(key: string) {
  return fields.find((field) => field.key === key) ?? null
}

const placedKeys = new Set(["name", "email", "phone", "message"])
const extraFields = fields.filter((field) => !placedKeys.has(field.key))
const canSubmit = Boolean(submitUrl)
const showForm = canSubmit || fields.length > 0`

function isFormPropsSchema(schema: ComponentPropsSchema) {
  return Object.values(schema).some((definition) => normalizePropType(definition.type) === "formFields")
}

function buildFormInterfaceBlock(schema: ComponentPropsSchema) {
  const lines = Object.entries(schema).map(([key, definition]) => {
    const type = normalizePropType(definition.type)
    return `  ${key}?: ${propTypeToTs(type, definition.fields)}`
  })

  if (!lines.some((line) => line.startsWith("  submitUrl"))) {
    lines.push("  submitUrl?: string")
  }

  return `interface Props {\n${lines.join("\n")}\n}`
}

function buildFormDestructureLine(schema: ComponentPropsSchema, previewProps: Record<string, unknown>) {
  const merged = mergePreviewPropsWithSchema(schema, previewProps)
  const entries = Object.entries(schema).map(([key, definition]) => {
    const type = normalizePropType(definition.type)
    return `${key} = ${formatDefaultLiteral(type, merged[key] ?? defaultValueForPropType(type), definition)}`
  })

  entries.push(`submitUrl = ${JSON.stringify(String(merged.submitUrl ?? ""))}`)

  return `const { ${entries.join(", ")} } = Astro.props`
}

function buildFormFrontmatterBody(
  existingFrontmatter: string,
  schema: ComponentPropsSchema,
  previewProps: Record<string, unknown>,
) {
  const imports = dedupeImportLines([
    ...extractImportLines(existingFrontmatter),
    'import FormField from "../../FormField.astro"',
    'import type { FormFieldSchema } from "../../FormField.astro"',
  ])
  const interfaceBlock = buildFormInterfaceBlock(schema)
  const destructureLine = buildFormDestructureLine(schema, previewProps)

  return [...imports, "", interfaceBlock, "", destructureLine, "", FORM_FRONTMATTER_HELPERS].join("\n").trim()
}

function buildInterfaceBlock(schema: ComponentPropsSchema) {
  const usesNested = Object.values(schema).some((definition) => {
    const type = normalizePropType(definition.type)
    return type === "component" || type === "dynamicZone"
  })

  const nestedType = `type NestedComponentInstance = {\n  id: string\n  componentSlug: string\n  variantSlug: string\n  props: Record<string, unknown>\n}`

  const lines = Object.entries(schema).map(([key, definition]) => {
    const type = normalizePropType(definition.type)
    return `  ${key}?: ${propTypeToTs(type, definition.fields)}`
  })

  const blocks = [usesNested ? nestedType : "", `interface Props {\n${lines.join("\n")}\n}`].filter(Boolean)

  return blocks.join("\n\n")
}

function buildDestructureLine(schema: ComponentPropsSchema, previewProps: Record<string, unknown>) {
  const merged = mergePreviewPropsWithSchema(schema, previewProps)
  const entries = Object.entries(schema).map(([key, definition]) => {
    const type = normalizePropType(definition.type)
    return `${key} = ${formatDefaultLiteral(type, merged[key] ?? defaultValueForPropType(type), definition)}`
  })

  return `const { ${entries.join(", ")} } = Astro.props`
}

function dedupeImportLines(imports: string[]) {
  const seen = new Set<string>()

  return imports.filter((line) => {
    const normalized = line.trim()

    if (!normalized || seen.has(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

function extractImportLines(frontmatter: string) {
  return dedupeImportLines(
    (frontmatter.match(/^import\s+.+$/gm) ?? []).filter(
      (line) => !FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(line)),
    ),
  )
}

function buildRequiredImports(schema: ComponentPropsSchema, existingImports: string[]) {
  const imports = [...existingImports]

  if (schemaUsesPropType(schema, "richText")) {
    imports.push('import CmsRichText from "../../CmsRichText.astro"')
  }

  if (schemaUsesPropType(schema, "component") || schemaUsesPropType(schema, "dynamicZone")) {
    imports.push('import CmsNestedZone from "../../CmsNestedZone.astro"')
  }

  return dedupeImportLines(imports)
}

function rebuildFrontmatterBody(
  existingFrontmatter: string,
  schema: ComponentPropsSchema,
  previewProps: Record<string, unknown>,
) {
  if (isFormPropsSchema(schema)) {
    return buildFormFrontmatterBody(existingFrontmatter, schema, previewProps)
  }

  const imports = buildRequiredImports(schema, extractImportLines(existingFrontmatter))
  const interfaceBlock = buildInterfaceBlock(schema)
  const destructureLine = buildDestructureLine(schema, previewProps)

  return [...imports, "", interfaceBlock, "", destructureLine].join("\n").trim()
}

function propIsUsedInTemplate(template: string, key: string) {
  return (
    template.includes(`${key}.`) ||
    template.includes(`{${key}`) ||
    template.includes(`={${key}`) ||
    template.includes(` ${key} `) ||
    template.includes(`(${key})`) ||
    template.includes(`${key}?.map`) ||
    template.includes(`${key}.map`)
  )
}

function buildRepeaterItemSnippet(fields: RepeaterFieldsSchema, itemVar: string) {
  return Object.entries(fields)
    .map(([fieldKey, fieldDefinition]) => {
      const type = normalizePropType(fieldDefinition.type)

      switch (type) {
        case "richText":
          return `      <CmsRichText html={${itemVar}.${fieldKey}} />`
        case "image":
          return `      <img src={${itemVar}.${fieldKey}.src || "${IMAGE_PLACEHOLDER_URL}"} alt={${itemVar}.${fieldKey}.alt} class="aspect-video w-full rounded-lg object-cover" loading="lazy" decoding="async" />`
        case "link":
          return `      <a href={${itemVar}.${fieldKey}.href} target={${itemVar}.${fieldKey}.target}>{${itemVar}.${fieldKey}.title}</a>`
        case "boolean":
          return `      {${itemVar}.${fieldKey} ? <p>${fieldDefinition.label}</p> : null}`
        default:
          return `      <p>{${itemVar}.${fieldKey}}</p>`
      }
    })
    .join("\n")
}

function buildPropUsageSnippet(key: string, definition: ComponentPropDefinition) {
  const type = normalizePropType(definition.type)

  switch (type) {
    case "richText":
      return `\n  <CmsRichText html={${key}} />\n`
    case "image":
      return `\n  <img src={${key}.src || "${IMAGE_PLACEHOLDER_URL}"} alt={${key}.alt} class="aspect-video w-full rounded-lg object-cover" loading="lazy" decoding="async" />\n`
    case "link":
      return `\n  <a href={${key}.href} target={${key}.target}>{${key}.title}</a>\n`
    case "repeater": {
      const fields = definition.fields ?? defaultRepeaterFields()
      const itemSnippet = buildRepeaterItemSnippet(fields, "item")
      return `\n  {${key}?.map((item) => (\n    <div class="cms-repeater-item">\n${itemSnippet}\n    </div>\n  ))}\n`
    }
    case "component":
      return `\n  <CmsNestedZone items={${key}} />\n`
    case "dynamicZone":
      return `\n  <CmsNestedZone items={${key}} />\n`
    case "boolean":
      return `\n  {${key} ? <p>${definition.label}</p> : null}\n`
    case "formFields":
    case "siteForm":
      return ""
    case "number":
    case "date":
    case "text":
    case "textarea":
      return `\n  <p>{${key}}</p>\n`
    default:
      return `\n  <p>{${key}}</p>\n`
  }
}

function schemaUsesPropType(schema: ComponentPropsSchema, targetType: ComponentPropType) {
  for (const definition of Object.values(schema)) {
    const type = normalizePropType(definition.type)

    if (type === targetType) {
      return true
    }

    if (type === "repeater" && definition.fields) {
      for (const fieldDefinition of Object.values(definition.fields)) {
        if (normalizePropType(fieldDefinition.type) === targetType) {
          return true
        }
      }
    }
  }

  return false
}

function convertLegacyCmsComponents(template: string) {
  let result = template

  result = result.replace(
    /<CmsLink\s+link=\{(\w+)\}\s*\/>/g,
    '<a href={$1.href} target={$1.target}>{$1.title}</a>',
  )

  result = result.replace(/<CmsImage[\s\S]*?\/>/g, (match) => {
    const srcObjectMatch = match.match(/src=\{(\w+)\.src\}/)
    const srcVarMatch = match.match(/src=\{(\w+)\}/)
    const imageVar = srcObjectMatch?.[1] ?? srcVarMatch?.[1] ?? "image"
    const classMatch = match.match(/class="([^"]*)"/)
    const classAttr = classMatch
      ? ` class="${classMatch[1]}"`
      : ` class="aspect-video w-full rounded-lg object-cover"`

    return `<img src={${imageVar}.src || "${IMAGE_PLACEHOLDER_URL}"} alt={${imageVar}.alt}${classAttr} loading="lazy" decoding="async" />`
  })

  return result
}

function fixMalformedImgTags(template: string) {
  return template
    .replace(
      /<img([^>]*?)\salt=\{([^}]+)\}([^>]*?)\salt=\{[^}]+\}([^>]*?)\/>/g,
      '<img$1 alt={$2}$3$4 />',
    )
    .replace(
      /<img([^>]*?)\salt=\{([^}]+)\}([^>]*?)\salt="[^"]*"([^>]*?)\/>/g,
      '<img$1 alt={$2}$3$4 />',
    )
    .replace(/\salt=\{imageAlt\}/g, "")
}

function removeTrailingAutoSnippets(template: string, schema: ComponentPropsSchema) {
  const closingTags = ["</section>", "</article>"]
  let cutIndex = -1

  for (const tag of closingTags) {
    const index = template.lastIndexOf(tag)

    if (index > cutIndex) {
      cutIndex = index + tag.length
    }
  }

  if (cutIndex === -1) {
    return template
  }

  const head = template.slice(0, cutIndex)
  let tail = template.slice(cutIndex).trim()

  if (!tail) {
    return head
  }

  for (const [key, definition] of Object.entries(schema)) {
    const snippet = buildPropUsageSnippet(key, definition).trim()
    tail = tail.replace(snippet, "")
    tail = tail.replace(snippet.replace(/\n/g, "\r\n"), "")
  }

  tail = tail
    .replace(/\s*<a href=\{\w+\.href\}[\s\S]*?<\/a>\s*/g, "")
    .replace(/\s*<img[\s\S]*?\/>\s*/g, "")
    .replace(/\s*\{\w+\?\.map\(\(item\) => \([\s\S]*?\)\)\}\s*/g, "")
    .replace(/\s*<p>\{\w+\}<\/p>\s*/g, "")
    .trim()

  return tail ? `${head}\n${tail}` : head
}

function removeAutoAppendedPropSnippets(template: string, schema: ComponentPropsSchema) {
  let result = template

  for (const [key, definition] of Object.entries(schema)) {
    const snippet = buildPropUsageSnippet(key, definition).trim()

    if (snippet && result.includes(snippet)) {
      result = result.replace(snippet, "")
    }
  }

  return result.replace(/\n{3,}/g, "\n\n")
}

function ensurePropUsageInTemplate(template: string, schema: ComponentPropsSchema) {
  let result = template

  for (const [key, definition] of Object.entries(schema)) {
    if (propIsUsedInTemplate(result, key)) {
      continue
    }

    result = `${result.trimEnd()}${buildPropUsageSnippet(key, definition)}`
  }

  return result
}

function syncTemplate(template: string, schema: ComponentPropsSchema) {
  const cleaned = fixMalformedImgTags(convertLegacyCmsComponents(template))
  const withoutTrailing = removeTrailingAutoSnippets(cleaned, schema)
  return removeAutoAppendedPropSnippets(withoutTrailing, schema)
}

export function syncPropsToAstroFrontmatter(
  code: string,
  schema: ComponentPropsSchema,
  previewProps: Record<string, unknown>,
) {
  const frontmatterMatch = code.match(/^---\r?\n([\s\S]*?)\r?\n---/)

  if (!frontmatterMatch) {
    return code
  }

  const frontmatterBody = frontmatterMatch[1]

  if (!frontmatterBody) {
    return code
  }

  const frontmatter = rebuildFrontmatterBody(frontmatterBody, schema, previewProps)
  const template = syncTemplate(code.slice(frontmatterMatch[0].length), schema)

  return `---\n${frontmatter}\n---${template}`
}
