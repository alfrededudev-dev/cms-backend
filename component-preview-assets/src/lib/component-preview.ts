export function variantSlugToFileName(slug: string) {
  return `${slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}.astro`
}

export function fileNameToVariantSlug(fileName: string) {
  const base = fileName.replace(/\.astro$/, "")
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
}

export function getComponentPreviewPaths() {
  const blockModules = import.meta.glob("../components/blocks/**/*.astro")
  const blockPreviewModules = import.meta.glob<{ default: Record<string, Record<string, unknown>> }>(
    "../components/blocks/*/preview.json",
    { import: "default", eager: true },
  )

  const paths: Array<{
    params: { component: string; variant: string }
    props: Record<string, unknown>
  }> = []

  for (const modulePath of Object.keys(blockModules)) {
    const match = modulePath.match(/blocks\/([^/]+)\/([^/]+\.astro)$/)
    if (!match) {
      continue
    }

    const [, component, fileName] = match
    const variant = fileNameToVariantSlug(fileName)
    const previewPath = `../components/blocks/${component}/preview.json`
    const previewModule = blockPreviewModules[previewPath]
    const previewData = previewModule?.default ?? {}
    const rawProps = previewData[variant] ?? {}
    const props =
      typeof rawProps === "object" && rawProps !== null && !Array.isArray(rawProps)
        ? Object.fromEntries(
            Object.entries(rawProps).filter(([key]) => key !== "_schema"),
          )
        : {}

    paths.push({
      params: { component, variant },
      props,
    })
  }

  return paths
}

export const componentModules = import.meta.glob("../components/blocks/**/*.astro")
