export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function slugifyLayoutName(value: string) {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")

  return slugify(normalized)
}

export function layoutNameToFileName(name: string) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9]/g, "")
  return `${cleaned || "Layout"}.astro`
}

export function variantSlugToFileName(slug: string) {
  return `${slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}.astro`
}

export function variantNameToSlug(name: string) {
  return slugify(name)
}
