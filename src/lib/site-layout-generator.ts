import fs from "node:fs/promises"
import path from "node:path"
import { serializeBoundProps } from "./content-binding.js"
import { layoutToFileName, type SiteLayoutRef } from "./layout-routing.js"
import { buildBlockThemeScopeStyle, normalizeThemeColorMapping, type ThemeColorMapping } from "./theme-tokens.js"
import { getSiteWorkspacePath } from "./paths.js"
import { variantSlugToFileName } from "./slug.js"

export type GeneratedLayoutBlock = {
  componentSlug: string
  variantSlug: string
  props: Record<string, unknown>
  themeColorMap?: ThemeColorMapping
}

function toImportAlias(index: number, componentSlug: string) {
  const safeSlug = componentSlug.replace(/[^a-zA-Z0-9]/g, "_")
  return `LayoutBlock${index}_${safeSlug}`
}

function buildNestedLayoutMarkup(blocks: GeneratedLayoutBlock[]) {
  if (blocks.length === 0) {
    return "\t\t<slot />"
  }

  let content = "\t\t<slot />"

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!
    const alias = toImportAlias(index, block.componentSlug)
    const props = serializeBoundProps(block.props, null)
    const scopeStyle = buildBlockThemeScopeStyle(normalizeThemeColorMapping(block.themeColorMap))
    const opening = props ? `<${alias} ${props}>` : `<${alias}>`
    const wrappedOpening = scopeStyle
      ? `<div class="cms-block-theme" style="${scopeStyle}">\n\t\t${opening}`
      : `\t\t${opening}`
    const wrappedClosing = scopeStyle ? `</${alias}>\n\t\t</div>` : `</${alias}>`
    content = scopeStyle
      ? `\t\t${wrappedOpening}\n${content}\n\t\t${wrappedClosing}`
      : `\t\t${opening}\n${content}\n\t\t</${alias}>`
  }

  return content
}

export function generateLayoutAstroContent(blocks: GeneratedLayoutBlock[]) {
  const imports = blocks
    .map((block, index) => {
      const alias = toImportAlias(index, block.componentSlug)
      const fileName = variantSlugToFileName(block.variantSlug)
      return `import ${alias} from "../components/blocks/${block.componentSlug}/${fileName}"`
    })
    .join("\n")

  const body = buildNestedLayoutMarkup(blocks)

  return `---
import "../styles/global.css";
import siteTheme from "../cms/theme.json";
import customCode from "../cms/custom-code.json";
import siteSettings from "../data/site-settings.json";
${imports ? `${imports}\n` : ""}
interface Props {
\ttitle?: string;
}

const { title } = Astro.props;
const pageTitle = title ?? "Site";
const assetBase = import.meta.env.BASE_URL;
---

<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="UTF-8" />
\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />
\t\t<meta name="generator" content={Astro.generator} />
\t\t<link rel="icon" type="image/svg+xml" href={\`\${assetBase}favicon.svg\`} />
\t\t<title>{pageTitle}</title>
\t\t{siteTheme.headStylesHtml ? <Fragment set:html={siteTheme.headStylesHtml} /> : null}
\t\t{customCode.headLinksHtml ? <Fragment set:html={customCode.headLinksHtml} /> : null}
\t\t{customCode.headStylesHtml ? <Fragment set:html={customCode.headStylesHtml} /> : null}
\t\t{customCode.headScriptsHtml ? <Fragment set:html={customCode.headScriptsHtml} /> : null}
\t\t<script is:inline>
\t\t\tconst setHtmlFontSize = (width) => document.documentElement.style.fontSize = \`\${window.innerWidth / width}px\`
\t\t\tconst updateHtmlFontSize = () => window.innerWidth >= 992 ? setHtmlFontSize(1440) : setHtmlFontSize(360)
\t\t\tupdateHtmlFontSize()
\t\t\twindow.addEventListener("resize", updateHtmlFontSize)
\t\t</script>
\t</head>
\t<body>
${body}
\t\t{customCode.bodyScriptsHtml ? <Fragment set:html={customCode.bodyScriptsHtml} /> : null}
\t</body>
</html>
`
}

export async function generateSiteLayout(
  workspacesDir: string,
  siteId: number,
  blocks: GeneratedLayoutBlock[],
  layout: SiteLayoutRef,
) {
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const fileName = layoutToFileName(layout)
  const layoutPath = path.join(workspacePath, "src", "layouts", fileName)

  await fs.mkdir(path.dirname(layoutPath), { recursive: true })
  await fs.writeFile(layoutPath, generateLayoutAstroContent(blocks), "utf8")
}

export async function generateSiteLayouts(
  workspacesDir: string,
  siteId: number,
  layouts: Array<{ slug: string; name: string; isDefault: boolean; blocks: GeneratedLayoutBlock[] }>,
) {
  const workspacePath = getSiteWorkspacePath(workspacesDir, siteId)
  const layoutsDir = path.join(workspacePath, "src", "layouts")
  const managedFiles = new Set<string>(["Layout.astro"])

  for (const layout of layouts) {
    const fileName = layoutToFileName(layout)
    managedFiles.add(fileName)
    await generateSiteLayout(workspacesDir, siteId, layout.blocks, layout)
  }

  let entries: string[] = []

  try {
    entries = await fs.readdir(layoutsDir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.endsWith(".astro") || entry === "Layout.astro") {
      continue
    }

    if (!managedFiles.has(entry)) {
      await fs.unlink(path.join(layoutsDir, entry))
    }
  }
}
