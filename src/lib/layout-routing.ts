import { getImportPrefix } from "./site-routing.js"
import { layoutNameToFileName } from "./slug.js"

export type SiteLayoutRef = {
  slug: string
  name: string
  isDefault: boolean
}

export function layoutToFileName(layout: SiteLayoutRef) {
  if (layout.isDefault) {
    return "Layout.astro"
  }

  return layoutNameToFileName(layout.name)
}

export function layoutToImportAlias(layout: SiteLayoutRef) {
  if (layout.isDefault) {
    return "Layout"
  }

  const cleaned = layout.name.trim().replace(/[^a-zA-Z0-9]/g, "")
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return "Layout"
  }

  return cleaned
}

export function layoutFilePathLabel(layout: SiteLayoutRef) {
  return `src/layouts/${layoutToFileName(layout)}`
}

export function getLayoutImportStatement(relativeFilePath: string, layout: SiteLayoutRef) {
  const prefix = getImportPrefix(relativeFilePath)
  const fileName = layoutToFileName(layout)
  const alias = layoutToImportAlias(layout)
  return `import ${alias} from "${prefix}layouts/${fileName}"`
}
