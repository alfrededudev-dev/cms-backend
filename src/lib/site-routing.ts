const HOME_SLUGS = new Set(["home", "index", ""])

export function normalizePageSlug(slug: string) {
  return slug.trim().replace(/^\/+|\/+$/g, "")
}

export function isHomeSlug(slug: string) {
  return HOME_SLUGS.has(normalizePageSlug(slug))
}

export function pageSlugToRoutePath(slug: string, collectionSlugs: ReadonlySet<string> = new Set()) {
  const normalized = normalizePageSlug(slug)

  if (isHomeSlug(normalized)) {
    return "/"
  }

  if (collectionSlugs.has(normalized)) {
    return `/${normalized}`
  }

  return `/${normalized}`
}

export function collectionEntryRoutePath(collectionSlug: string, entrySlug: string) {
  return `/${collectionSlug}/${entrySlug}`
}

export function pageSlugToFilePath(
  slug: string,
  collectionSlugs: ReadonlySet<string> = new Set(),
  pageType: "static" | "collection" = "static",
) {
  const normalized = normalizePageSlug(slug)

  if (isHomeSlug(normalized)) {
    return "src/pages/index.astro"
  }

  if (pageType === "collection") {
    return collectionEntryRouteFilePath(normalized)
  }

  if (collectionSlugs.has(normalized)) {
    return `src/pages/${normalized}/index.astro`
  }

  return `src/pages/${normalized}.astro`
}

export function canAddTemplatePageSlug(
  slug: string,
  pageType: "static" | "collection",
  pages: Array<{ slug: string; pageType: "static" | "collection" }>,
) {
  const normalized = normalizePageSlug(slug)
  const sameSlugPages = pages.filter((page) => normalizePageSlug(page.slug) === normalized)

  if (sameSlugPages.length === 0) {
    return true
  }

  if (sameSlugPages.length >= 2) {
    return false
  }

  return !sameSlugPages.some((page) => page.pageType === pageType)
}

export function collectionEntryRouteFilePath(collectionSlug: string) {
  return `src/pages/${collectionSlug}/[slug].astro`
}

export function getImportPrefix(relativePagePath: string) {
  const pageRelative = relativePagePath.replace(/^src\/pages\//, "")
  const depth = pageRelative.split("/").length - 1
  return "../".repeat(depth + 1)
}

export function filePathToPageSlug(relativePath: string) {
  const normalized = relativePath.replace(/^src\/pages\//, "")

  if (normalized === "index.astro") {
    return "home"
  }

  if (normalized.endsWith("/index.astro")) {
    return normalized.replace(/\/index\.astro$/, "")
  }

  return normalized.replace(/\.astro$/, "")
}

export function isManagedCollectionEntryRoute(relativePath: string, collectionSlugs: ReadonlySet<string>) {
  const match = relativePath.match(/^src\/pages\/([^/]+)\/\[slug\]\.astro$/)
  if (!match) {
    return false
  }

  return collectionSlugs.has(match[1]!)
}
