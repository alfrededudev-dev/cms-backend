import fs from "node:fs/promises"
import path from "node:path"
import { resolveSiteWorkspacePath } from "./paths.js"

export type SiteCustomCodeInput = {
  headStyles: string
  headLinks: string
  headScripts: string
  bodyScripts: string
}

export type SiteCustomCodePayload = SiteCustomCodeInput & {
  headStylesHtml: string
  headLinksHtml: string
  headScriptsHtml: string
  bodyScriptsHtml: string
}

const CUSTOM_CODE_IMPORT = `import customCode from "../cms/custom-code.json";`
const CUSTOM_CODE_MARKER = "cms/custom-code.json"

function wrapCustomStyles(code: string) {
  const trimmed = code.trim()
  if (!trimmed) {
    return ""
  }

  if (/<style[\s>]/i.test(trimmed)) {
    return trimmed
  }

  return `<style is:inline>\n${trimmed}\n</style>`
}

function wrapCustomScripts(code: string) {
  const trimmed = code.trim()
  if (!trimmed) {
    return ""
  }

  if (/<script[\s>]/i.test(trimmed)) {
    return trimmed
  }

  return `<script is:inline>\n${trimmed}\n</script>`
}

function normalizeHeadLinks(code: string) {
  return code.trim()
}

export function buildCustomCodePayload(input: SiteCustomCodeInput): SiteCustomCodePayload {
  return {
    headStyles: input.headStyles,
    headLinks: input.headLinks,
    headScripts: input.headScripts,
    bodyScripts: input.bodyScripts,
    headStylesHtml: wrapCustomStyles(input.headStyles),
    headLinksHtml: normalizeHeadLinks(input.headLinks),
    headScriptsHtml: wrapCustomScripts(input.headScripts),
    bodyScriptsHtml: wrapCustomScripts(input.bodyScripts),
  }
}

async function ensureDirectory(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function ensureLayoutCustomCodeHooks(layoutPath: string) {
  let content = await fs.readFile(layoutPath, "utf8")

  if (!content.includes(CUSTOM_CODE_MARKER)) {
    const frontmatterEnd = content.indexOf("---", 3)
    if (frontmatterEnd === -1) {
      throw new Error("Layout.astro is missing frontmatter")
    }

    content = `${content.slice(0, frontmatterEnd)}\n${CUSTOM_CODE_IMPORT}\n${content.slice(frontmatterEnd)}`
  }

  if (!content.includes("customCode.headStyles")) {
    content = content.replace(
      "</head>",
      `\t\t{customCode.headLinksHtml ? <Fragment set:html={customCode.headLinksHtml} /> : null}\n\t\t{customCode.headStylesHtml ? <Fragment set:html={customCode.headStylesHtml} /> : null}\n\t\t{customCode.headScriptsHtml ? <Fragment set:html={customCode.headScriptsHtml} /> : null}\n\t</head>`,
    )
  } else if (!content.includes("customCode.headLinksHtml")) {
    content = content.replace(
      "{customCode.headStylesHtml",
      "{customCode.headLinksHtml ? <Fragment set:html={customCode.headLinksHtml} /> : null}\n\t\t{customCode.headStylesHtml",
    )
  }

  if (!content.includes("customCode.bodyScriptsHtml")) {
    content = content.replace(
      "</body>",
      `\t\t{customCode.bodyScriptsHtml ? <Fragment set:html={customCode.bodyScriptsHtml} /> : null}\n\t</body>`,
    )
  }

  await fs.writeFile(layoutPath, content, "utf8")
}

export async function syncSiteCustomCodeToWorkspace(
  workspacesDir: string,
  siteId: number,
  workspacePath: string | null | undefined,
  input: SiteCustomCodeInput,
) {
  const absoluteWorkspacePath = resolveSiteWorkspacePath(workspacesDir, siteId, workspacePath)
  const payload = buildCustomCodePayload(input)
  const cmsDir = path.join(absoluteWorkspacePath, "src", "cms")
  const customCodePath = path.join(cmsDir, "custom-code.json")
  const layoutPath = path.join(absoluteWorkspacePath, "src", "layouts", "Layout.astro")

  await ensureDirectory(cmsDir)

  await fs.writeFile(
    customCodePath,
    `${JSON.stringify(
      {
        headLinksHtml: payload.headLinksHtml,
        headStylesHtml: payload.headStylesHtml,
        headScriptsHtml: payload.headScriptsHtml,
        bodyScriptsHtml: payload.bodyScriptsHtml,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  try {
    await fs.access(layoutPath)
    await ensureLayoutCustomCodeHooks(layoutPath)
  } catch {
    // workspace layout may be missing until clone completes
  }

  return {
    workspacePath: absoluteWorkspacePath,
    customCodePath,
  }
}

export function getSiteCustomCodeFromRecord(site: {
  customHeadStyles: string
  customHeadLinks: string
  customHeadScripts: string
  customBodyScripts: string
}) {
  return {
    headStyles: site.customHeadStyles ?? "",
    headLinks: site.customHeadLinks ?? "",
    headScripts: site.customHeadScripts ?? "",
    bodyScripts: site.customBodyScripts ?? "",
  }
}
