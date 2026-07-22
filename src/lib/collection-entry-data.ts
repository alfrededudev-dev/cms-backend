import type { DataFieldDefinition } from "./data-model.js"

export const DEFAULT_COLLECTION_ENTRY_MODEL: DataFieldDefinition[] = [
  { key: "title", label: "Title", type: "text", required: true, sortOrder: 0 },
  { key: "excerpt", label: "Excerpt", type: "textarea", sortOrder: 1 },
  { key: "body", label: "Body", type: "markdown", sortOrder: 2 },
]

export function getEntryDisplayTitle(data: Record<string, unknown>, fallback = "Untitled") {
  const title = data.title ?? data.name
  return typeof title === "string" && title.trim() ? title.trim() : fallback
}

export function extractLegacyEntryColumns(data: Record<string, unknown>) {
  return {
    title: getEntryDisplayTitle(data),
    excerpt: typeof data.excerpt === "string" ? data.excerpt : null,
    body:
      typeof data.body === "string"
        ? data.body
        : typeof data.content === "string"
          ? data.content
          : null,
  }
}

export function mergeEntryDataForForm(
  data: Record<string, unknown>,
  legacy: { title: string; excerpt: string; body: string },
) {
  return {
    ...data,
    ...(legacy.title && data.title === undefined ? { title: legacy.title } : {}),
    ...(legacy.excerpt && data.excerpt === undefined ? { excerpt: legacy.excerpt } : {}),
    ...(legacy.body && data.body === undefined ? { body: legacy.body } : {}),
  }
}
