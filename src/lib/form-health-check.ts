import {
  defaultRepeaterFields,
  normalizeFieldsSchema,
  type DataFieldDefinition,
} from "./data-model.js"

export function buildHealthCheckFormPayload(fieldsSchema: DataFieldDefinition[]) {
  const data: Record<string, unknown> = {}

  for (const field of normalizeFieldsSchema(fieldsSchema)) {
    if (field.key.startsWith("_")) {
      continue
    }

    switch (field.type) {
      case "number":
        data[field.key] = 1
        break
      case "boolean":
        data[field.key] = true
        break
      case "url":
        data[field.key] = "https://example.com"
        break
      case "link":
        data[field.key] = { title: "CMS check", href: "https://example.com", target: "_self" }
        break
      case "image":
        data[field.key] = { src: "https://placehold.co/1x1", alt: "CMS check" }
        break
      case "date":
        data[field.key] = new Date().toISOString().slice(0, 10)
        break
      case "select":
        data[field.key] = field.options?.[0] ?? "test"
        break
      case "textarea":
      case "markdown":
        data[field.key] = "CMS forms health check"
        break
      case "repeater":
        data[field.key] = field.required
          ? [createEmptyRepeaterItem(field.fields ?? defaultRepeaterFields())]
          : []
        break
      case "component":
      case "dynamic_zone":
        if (field.required) {
          data[field.key] = field.type === "dynamic_zone" ? [] : null
        }
        break
      default:
        data[field.key] = "CMS health check"
    }
  }

  data._gotcha = ""
  return data
}

function createEmptyRepeaterItem(fields: Record<string, { type: string; label: string }>) {
  const item: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(fields)) {
    switch (definition.type) {
      case "number":
        item[key] = 1
        break
      case "boolean":
        item[key] = true
        break
      default:
        item[key] = "CMS check"
    }
  }

  return item
}
