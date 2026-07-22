import { and, eq, inArray } from "drizzle-orm"
import type { Db } from "../db/index.js"
import { listSiteForms, testSiteFormSubmitPipeline } from "../db/site-forms.js"
import { getSiteById } from "../db/sites.js"
import type { Env } from "../env.js"
import { verifySiteSmtpConfig } from "./form-mailer.js"
import { components, siteLayoutBlocks, siteLayouts, sitePageBlocks, sitePages } from "../db/schema.js"
import { collectComponentSlugsFromValue } from "./component-prop-schema.js"
import { isSmtpConfigured, parseNotifyEmails } from "./site-smtp.js"
import { normalizeSiteCheckUrl } from "./site-health-check.js"

export type FormsStatus = "healthy" | "issues" | "no_forms"

export type SiteFormApiCheckResult = {
  formSlug: string
  formName: string
  ok: boolean
  message: string
}

export type SiteFormSmtpCheckResult = {
  status: "ok" | "not_required" | "not_configured" | "failed"
  message: string
}

export type SiteFormsCheckResult = {
  formsStatus: FormsStatus
  checkedUrl: string
  configuredFormCount: number
  configuredFormSlugs: string[]
  configuredSiteFormCount: number
  configuredSiteFormSlugs: string[]
  liveFormCount: number
  smtp: SiteFormSmtpCheckResult
  apiChecks: SiteFormApiCheckResult[]
  message: string
}

const CHECK_TIMEOUT_MS = 12_000

export async function getSiteFormComponentSlugs(db: Db, siteId: number) {
  const slugs = new Set<string>()

  const pageBlocks = await db
    .select({
      componentSlug: components.slug,
      kind: components.kind,
      props: sitePageBlocks.props,
    })
    .from(sitePageBlocks)
    .innerJoin(sitePages, eq(sitePageBlocks.pageId, sitePages.id))
    .innerJoin(components, eq(sitePageBlocks.componentId, components.id))
    .where(eq(sitePages.siteId, siteId))

  for (const block of pageBlocks) {
    if (block.kind === "form") {
      slugs.add(block.componentSlug)
    }

    for (const nestedSlug of collectComponentSlugsFromValue(block.props)) {
      slugs.add(nestedSlug)
    }
  }

  const layoutBlocks = await db
    .select({
      componentSlug: components.slug,
      kind: components.kind,
      props: siteLayoutBlocks.props,
    })
    .from(siteLayoutBlocks)
    .innerJoin(siteLayouts, eq(siteLayoutBlocks.layoutId, siteLayouts.id))
    .innerJoin(components, eq(siteLayoutBlocks.componentId, components.id))
    .where(eq(siteLayouts.siteId, siteId))

  for (const block of layoutBlocks) {
    if (block.kind === "form") {
      slugs.add(block.componentSlug)
    }

    for (const nestedSlug of collectComponentSlugsFromValue(block.props)) {
      slugs.add(nestedSlug)
    }
  }

  const slugList = [...slugs]
  if (slugList.length === 0) {
    return []
  }

  const rows = await db
    .select({ slug: components.slug })
    .from(components)
    .where(and(inArray(components.slug, slugList), eq(components.kind, "form")))

  return rows.map((row) => row.slug)
}

function countFormsInHtml(html: string) {
  const cmsFormMarkers = html.match(/data-cms-form/gi)?.length ?? 0
  const formTags = html.match(/<form\b/gi)?.length ?? 0
  return Math.max(cmsFormMarkers, formTags)
}

async function fetchSitePageHtml(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "CMS-SiteFormsCheck/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function loadLiveSiteHtml(domain: string) {
  const primaryUrl = normalizeSiteCheckUrl(domain)
  const fallbackUrl = primaryUrl.startsWith("https://")
    ? primaryUrl.replace(/^https:\/\//i, "http://")
    : null

  let lastError: string | null = null

  for (const url of [primaryUrl, fallbackUrl].filter(Boolean) as string[]) {
    try {
      const html = await fetchSitePageHtml(url)
      return { html, checkedUrl: url }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Request failed"
    }
  }

  throw new Error(lastError ?? "Site is unreachable")
}

async function checkSiteFormsSmtp(db: Db, env: Env, siteId: number): Promise<SiteFormSmtpCheckResult> {
  const site = await getSiteById(db, siteId)
  if (!site) {
    return { status: "failed", message: "Site not found" }
  }

  const forms = await listSiteForms(db, siteId)
  const needsSmtp = forms.some((form) => parseNotifyEmails(form.settings?.notifyEmail).length > 0)

  if (!needsSmtp) {
    return {
      status: "not_required",
      message: "No admin notify emails configured on site forms",
    }
  }

  if (!isSmtpConfigured(site, env)) {
    return {
      status: "not_configured",
      message: "Forms have notify emails but SMTP is not configured (site or backend env)",
    }
  }

  try {
    await verifySiteSmtpConfig(env, site)
    return { status: "ok", message: "SMTP connection verified" }
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "SMTP verification failed",
    }
  }
}

async function checkSiteFormsApi(db: Db, env: Env, siteId: number): Promise<SiteFormApiCheckResult[]> {
  const forms = await listSiteForms(db, siteId)

  if (forms.length === 0) {
    return []
  }

  const results: SiteFormApiCheckResult[] = []

  for (const form of forms) {
    try {
      await testSiteFormSubmitPipeline(db, env, siteId, form.slug)
      results.push({
        formSlug: form.slug,
        formName: form.name,
        ok: true,
        message: "Submit API saved and validated a test submission",
      })
    } catch (error) {
      results.push({
        formSlug: form.slug,
        formName: form.name,
        ok: false,
        message: error instanceof Error ? error.message : "Submit API check failed",
      })
    }
  }

  return results
}

function buildFormsCheckMessage(input: {
  checkedUrl: string
  liveFormCount: number
  configuredFormCount: number
  configuredSiteFormCount: number
  smtp: SiteFormSmtpCheckResult
  apiChecks: SiteFormApiCheckResult[]
  siteUnreachable?: string
}) {
  const parts: string[] = []

  if (input.siteUnreachable) {
    parts.push(`Live site unreachable: ${input.siteUnreachable}`)
  } else {
    parts.push(
      input.liveFormCount > 0
        ? `Detected ${input.liveFormCount} form(s) on ${input.checkedUrl}`
        : `No forms detected on ${input.checkedUrl}`,
    )
  }

  parts.push(`${input.configuredSiteFormCount} form(s) configured in CMS`)

  const failedApi = input.apiChecks.filter((item) => !item.ok)
  if (input.apiChecks.length === 0) {
    parts.push("Submit API: no site forms to test")
  } else if (failedApi.length === 0) {
    parts.push(`Submit API: all ${input.apiChecks.length} form(s) passed`)
  } else {
    parts.push(
      `Submit API failed for ${failedApi.map((item) => item.formSlug).join(", ")}: ${failedApi[0]?.message ?? "unknown error"}`,
    )
  }

  parts.push(`SMTP: ${input.smtp.message}`)

  if (input.configuredFormCount > 0 && input.liveFormCount === 0 && !input.siteUnreachable) {
    parts.push(`${input.configuredFormCount} form component(s) in template/layout but none on live homepage`)
  }

  return parts.join(". ")
}

function resolveFormsStatus(input: {
  configuredFormCount: number
  configuredSiteFormCount: number
  liveFormCount: number
  smtp: SiteFormSmtpCheckResult
  apiChecks: SiteFormApiCheckResult[]
  siteUnreachable?: string
}): FormsStatus {
  const hasAnyForms =
    input.configuredFormCount > 0 || input.configuredSiteFormCount > 0 || input.liveFormCount > 0

  if (!hasAnyForms) {
    return "no_forms"
  }

  const apiFailed = input.apiChecks.some((item) => !item.ok)
  const smtpFailed =
    input.smtp.status === "not_configured" || input.smtp.status === "failed"
  const liveMissing =
    input.configuredSiteFormCount > 0 && input.liveFormCount === 0 && !input.siteUnreachable
  const siteDownWithForms = Boolean(input.siteUnreachable) && input.configuredSiteFormCount > 0

  if (apiFailed || smtpFailed || liveMissing || siteDownWithForms) {
    return "issues"
  }

  return "healthy"
}

export async function checkSiteFormsHealth(
  db: Db,
  env: Env,
  siteId: number,
  domain: string,
): Promise<SiteFormsCheckResult> {
  const configuredFormSlugs = await getSiteFormComponentSlugs(db, siteId)
  const configuredFormCount = configuredFormSlugs.length
  const siteForms = await listSiteForms(db, siteId)
  const configuredSiteFormSlugs = siteForms.map((form) => form.slug)
  const configuredSiteFormCount = configuredSiteFormSlugs.length

  const smtp = await checkSiteFormsSmtp(db, env, siteId)
  const apiChecks = await checkSiteFormsApi(db, env, siteId)

  let checkedUrl = normalizeSiteCheckUrl(domain)
  let liveFormCount = 0
  let siteUnreachable: string | undefined

  try {
    const live = await loadLiveSiteHtml(domain)
    checkedUrl = live.checkedUrl
    liveFormCount = countFormsInHtml(live.html)
  } catch (error) {
    siteUnreachable = error instanceof Error ? error.message : "Site is unreachable"
  }

  const formsStatus = resolveFormsStatus({
    configuredFormCount,
    configuredSiteFormCount,
    liveFormCount,
    smtp,
    apiChecks,
    siteUnreachable,
  })

  return {
    formsStatus,
    checkedUrl,
    configuredFormCount,
    configuredFormSlugs,
    configuredSiteFormCount,
    configuredSiteFormSlugs,
    liveFormCount,
    smtp,
    apiChecks,
    message: buildFormsCheckMessage({
      checkedUrl,
      liveFormCount,
      configuredFormCount,
      configuredSiteFormCount,
      smtp,
      apiChecks,
      siteUnreachable,
    }),
  }
}
