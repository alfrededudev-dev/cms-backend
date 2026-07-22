import { z } from "zod"
import {
  defaultImageValue,
  defaultLinkValue,
  normalizeComponentPropValue,
  normalizeDynamicZoneValue,
  normalizeImageValue,
  normalizeLinkValue,
} from "./component-prop-schema.js"
import { IMAGE_PLACEHOLDER_URL } from "./image-placeholder.js"

export const contentTypeKinds = ["collection", "single", "global"] as const

export type ContentTypeKind = (typeof contentTypeKinds)[number]

export const dataFieldTypes = [
  "text",
  "textarea",
  "markdown",
  "number",
  "boolean",
  "url",
  "link",
  "image",
  "date",
  "select",
  "repeater",
  "component",
  "dynamic_zone",
] as const

export type DataFieldType = (typeof dataFieldTypes)[number]

export const dataRepeaterFieldTypes = [
  "text",
  "textarea",
  "markdown",
  "number",
  "boolean",
  "url",
  "link",
  "image",
  "date",
  "select",
] as const

export type DataRepeaterFieldType = (typeof dataRepeaterFieldTypes)[number]

export type DataRepeaterFieldDefinition = {
  label: string
  type: DataRepeaterFieldType
  options?: string[]
}

export type DataRepeaterFieldsSchema = Record<string, DataRepeaterFieldDefinition>

export type NestedComponentInstance = {
  id: string
  componentSlug: string
  variantSlug: string
  props: Record<string, unknown>
}

export type DataFieldDefinition = {
  key: string
  label: string
  type: DataFieldType
  required?: boolean
  options?: string[]
  components?: string[]
  fields?: DataRepeaterFieldsSchema
  sortOrder: number
}

const dataRepeaterFieldDefinitionSchema = z.object({
  label: z.string().min(1),
  type: z.enum(dataRepeaterFieldTypes),
  options: z.array(z.string().min(1)).optional(),
})

export const dataFieldDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "Field key must be snake_case"),
  label: z.string().min(1),
  type: z.enum(dataFieldTypes),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
  components: z.array(z.string().min(1)).optional(),
  fields: z.record(z.string(), dataRepeaterFieldDefinitionSchema).optional(),
  sortOrder: z.number().int(),
})

export const fieldsSchemaSchema = z.array(dataFieldDefinitionSchema).max(50)

export function isDataLinkValueEmpty(value: unknown) {
  const link = normalizeLinkValue(value)
  return !link.title.trim() && !link.href.trim()
}

export function isDataImageValueEmpty(value: unknown) {
  const image = normalizeImageValue(value)
  const src = image.src.trim()
  return !src || src === IMAGE_PLACEHOLDER_URL
}

export function defaultRepeaterFields(): DataRepeaterFieldsSchema {
  return {
    title: { type: "text", label: "Title" },
    description: { type: "textarea", label: "Description" },
  }
}

export function normalizeDataRepeaterFieldType(type: string): DataRepeaterFieldType {
  if ((dataRepeaterFieldTypes as readonly string[]).includes(type)) {
    return type as DataRepeaterFieldType
  }

  return "text"
}

export function normalizeRepeaterFieldsSchema(fields: DataRepeaterFieldsSchema): DataRepeaterFieldsSchema {
  return Object.fromEntries(
    Object.entries(fields).map(([key, definition]) => {
      const normalizedType = normalizeDataRepeaterFieldType(definition.type)

      return [
        key,
        {
          label: definition.label,
          type: normalizedType,
          ...(normalizedType === "select" && Array.isArray(definition.options)
            ? { options: definition.options.map((item) => item.trim()).filter(Boolean) }
            : {}),
        },
      ]
    }),
  )
}

function defaultValueForDataRepeaterFieldType(type: DataRepeaterFieldType) {
  switch (type) {
    case "boolean":
      return false
    case "number":
      return ""
    case "link":
      return defaultLinkValue()
    case "image":
      return defaultImageValue()
    default:
      return ""
  }
}

export function createEmptyRepeaterItem(fields: DataRepeaterFieldsSchema) {
  const item: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(normalizeRepeaterFieldsSchema(fields))) {
    item[key] = defaultValueForDataRepeaterFieldType(definition.type)
  }

  return item
}

export function normalizeRepeaterValue(value: unknown, fields: DataRepeaterFieldsSchema) {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedFields = normalizeRepeaterFieldsSchema(fields)

  return value.map((item) => {
    const normalizedItem = createEmptyRepeaterItem(normalizedFields)

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return normalizedItem
    }

    for (const [key, definition] of Object.entries(normalizedFields)) {
      const raw = (item as Record<string, unknown>)[key]

      if (raw === undefined || raw === null || raw === "") {
        continue
      }

      if (definition.type === "boolean") {
        normalizedItem[key] = raw === true || raw === "true"
        continue
      }

      if (definition.type === "number") {
        const numeric = typeof raw === "number" ? raw : Number(raw)
        normalizedItem[key] = Number.isNaN(numeric) ? "" : numeric
        continue
      }

      if (definition.type === "link") {
        normalizedItem[key] = normalizeLinkValue(raw)
        continue
      }

      if (definition.type === "image") {
        normalizedItem[key] = normalizeImageValue(raw)
        continue
      }

      normalizedItem[key] = raw
    }

    return normalizedItem
  })
}

function validateRepeaterSubFieldValue(
  label: string,
  definition: DataRepeaterFieldDefinition,
  value: unknown,
  errors: string[],
) {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === "" ||
    (definition.type === "link" && isDataLinkValueEmpty(value)) ||
    (definition.type === "image" && isDataImageValueEmpty(value))

  if (isEmpty) {
    return
  }

  switch (definition.type) {
    case "number":
      if (typeof value !== "number" && Number.isNaN(Number(value))) {
        errors.push(`${label} must be a number`)
      }
      break
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${label} must be true or false`)
      }
      break
    case "url":
      if (typeof value !== "string") {
        errors.push(`${label} must be a URL string`)
      }
      break
    case "link":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${label} must be a link object`)
      }
      break
    case "image":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${label} must be an image object`)
      }
      break
    case "select":
      if (typeof value !== "string" || !(definition.options ?? []).includes(value)) {
        errors.push(`${label} has an invalid option`)
      }
      break
    default:
      if (typeof value !== "string") {
        errors.push(`${label} must be text`)
      }
  }
}

export function normalizeFieldsSchema(fields: DataFieldDefinition[]): DataFieldDefinition[] {
  return [...fields]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((field, index): DataFieldDefinition => {
      const normalized: DataFieldDefinition = {
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        sortOrder: index,
        ...(field.required !== undefined ? { required: field.required } : {}),
      }

      if (field.type === "select" && field.options) {
        normalized.options = field.options.map((item) => item.trim()).filter(Boolean)
      }

      if (field.type === "component" || field.type === "dynamic_zone") {
        normalized.components = Array.isArray(field.components)
          ? field.components.map((item) => item.trim()).filter(Boolean)
          : []
      }

      if (field.type === "repeater") {
        normalized.fields = normalizeRepeaterFieldsSchema(field.fields ?? defaultRepeaterFields())
      }

      return normalized
    })
}

export function normalizeFormFieldsFromProp(value: unknown): DataFieldDefinition[] {
  if (!Array.isArray(value)) {
    return []
  }

  const fields: DataFieldDefinition[] = []

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue
    }

    const record = item as Record<string, unknown>
    const key = String(record.key ?? "").trim()
    const label = String(record.label ?? "").trim()

    if (!key || !label) {
      continue
    }

    fields.push({
      key,
      label,
      type: String(record.type ?? "text") as DataFieldDefinition["type"],
      required: record.required === true,
      sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : index,
      ...(Array.isArray(record.options) ? { options: record.options.map(String) } : {}),
    })
  }

  return normalizeFieldsSchema(fields)
}

export function validateFieldValues(
  fieldsSchema: DataFieldDefinition[],
  values: Record<string, unknown>,
) {
  const normalized = normalizeFieldsSchema(fieldsSchema)
  const errors: string[] = []

  for (const field of normalized) {
    const value = values[field.key]
    const isEmpty =
      value === undefined ||
      value === null ||
      value === "" ||
      (field.type === "boolean" && value === false && !field.required) ||
      (field.type === "component" && normalizeComponentPropValue(value) === null) ||
      (field.type === "dynamic_zone" && normalizeDynamicZoneValue(value).length === 0) ||
      (field.type === "repeater" && (!Array.isArray(value) || value.length === 0)) ||
      (field.type === "link" && isDataLinkValueEmpty(value)) ||
      (field.type === "image" && isDataImageValueEmpty(value))

    if (
      field.required &&
      (value === undefined ||
        value === null ||
        value === "" ||
        (field.type === "repeater" && (!Array.isArray(value) || value.length === 0)) ||
        (field.type === "link" && isDataLinkValueEmpty(value)) ||
        (field.type === "image" && isDataImageValueEmpty(value)))
    ) {
      errors.push(`${field.label} is required`)
      continue
    }

    if (isEmpty) {
      continue
    }

    switch (field.type) {
      case "number":
        if (typeof value !== "number" && Number.isNaN(Number(value))) {
          errors.push(`${field.label} must be a number`)
        }
        break
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(`${field.label} must be true or false`)
        }
        break
      case "url":
        if (typeof value !== "string") {
          errors.push(`${field.label} must be a URL string`)
        }
        break
      case "link":
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${field.label} must be a link object`)
        }
        break
      case "image":
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${field.label} must be an image object`)
        }
        break
      case "select":
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) {
          errors.push(`${field.label} has an invalid option`)
        }
        break
      case "component":
        if (normalizeComponentPropValue(value) === null) {
          errors.push(`${field.label} must include a component`)
        }
        break
      case "dynamic_zone":
        if (normalizeDynamicZoneValue(value).length === 0) {
          errors.push(`${field.label} must include at least one component`)
        }
        break
      case "repeater": {
        const repeaterFields = field.fields ?? defaultRepeaterFields()
        if (!Array.isArray(value)) {
          errors.push(`${field.label} must be a list`)
          break
        }

        value.forEach((item, index) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            errors.push(`${field.label} item ${index + 1} is invalid`)
            return
          }

          for (const [subKey, subDefinition] of Object.entries(repeaterFields)) {
            validateRepeaterSubFieldValue(
              `${field.label} item ${index + 1} — ${subDefinition.label}`,
              subDefinition,
              (item as Record<string, unknown>)[subKey],
              errors,
            )
          }
        })
        break
      }
      default:
        if (typeof value !== "string") {
          errors.push(`${field.label} must be text`)
        }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "))
  }

  const result: Record<string, unknown> = {}

  for (const field of normalized) {
    const value = values[field.key]
    if (value === undefined || value === null || value === "") {
      continue
    }

    if (field.type === "link" && isDataLinkValueEmpty(value)) {
      continue
    }

    if (field.type === "image" && isDataImageValueEmpty(value)) {
      continue
    }

    if (field.type === "number") {
      result[field.key] = typeof value === "number" ? value : Number(value)
      continue
    }

    if (field.type === "component") {
      result[field.key] = normalizeComponentPropValue(value)
      continue
    }

    if (field.type === "dynamic_zone") {
      result[field.key] = normalizeDynamicZoneValue(value)
      continue
    }

    if (field.type === "repeater") {
      result[field.key] = normalizeRepeaterValue(value, field.fields ?? defaultRepeaterFields())
      continue
    }

    if (field.type === "link") {
      result[field.key] = normalizeLinkValue(value)
      continue
    }

    if (field.type === "image") {
      result[field.key] = normalizeImageValue(value)
      continue
    }

    result[field.key] = value
  }

  return result
}

export function createEmptyFieldValues(fieldsSchema: DataFieldDefinition[]) {
  const values: Record<string, unknown> = {}

  for (const field of normalizeFieldsSchema(fieldsSchema)) {
    switch (field.type) {
      case "boolean":
        values[field.key] = false
        break
      case "number":
        values[field.key] = ""
        break
      case "component":
        values[field.key] = null
        break
      case "dynamic_zone":
        values[field.key] = []
        break
      case "repeater":
        values[field.key] = []
        break
      case "link":
        values[field.key] = defaultLinkValue()
        break
      case "image":
        values[field.key] = defaultImageValue()
        break
      default:
        values[field.key] = ""
    }
  }

  return values
}
