import type { DataFieldDefinition } from "./data-model.js"

export const DEFAULT_CONTACT_FORM_FIELDS: DataFieldDefinition[] = [
  { key: "name", label: "Name", type: "text", required: true, sortOrder: 0 },
  { key: "email", label: "Email", type: "text", required: true, sortOrder: 1 },
  { key: "phone", label: "Phone", type: "text", sortOrder: 2 },
  { key: "message", label: "Message", type: "textarea", required: true, sortOrder: 3 },
]

export function humanizeFormSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function collectFormSlugsFromProps(props: Record<string, unknown>) {
  const slugs = new Set<string>()
  const formSlug = props.formSlug

  if (typeof formSlug === "string" && formSlug.trim()) {
    slugs.add(formSlug.trim())
  }

  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "props" in item) {
          for (const nestedSlug of collectFormSlugsFromProps(
            (item as { props?: Record<string, unknown> }).props ?? {},
          )) {
            slugs.add(nestedSlug)
          }
        }
      }
      continue
    }

    if ("props" in value && value.props && typeof value.props === "object") {
      for (const nestedSlug of collectFormSlugsFromProps(value.props as Record<string, unknown>)) {
        slugs.add(nestedSlug)
      }
    }
  }

  return [...slugs]
}

export function collectFormSlugsFromBlocks(
  blocks: Array<{ props: Record<string, unknown> }>,
) {
  const slugs = new Set<string>()

  for (const block of blocks) {
    for (const slug of collectFormSlugsFromProps(block.props)) {
      slugs.add(slug)
    }
  }

  return [...slugs]
}
