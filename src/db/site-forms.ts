import { and, asc, desc, eq } from "drizzle-orm"
import type { Env } from "../env.js"
import { extractApplicationSummary } from "../lib/application-summary.js"
import { sendFormSubmissionEmail } from "../lib/form-mailer.js"
import { parseNotifyEmails } from "../lib/site-smtp.js"
import {
  DEFAULT_CONTACT_FORM_FIELDS,
  collectFormSlugsFromBlocks,
  humanizeFormSlug,
} from "../lib/site-form-defaults.js"
import { resolveFormDefinitionFromBlock, type SiteFormBlockRef } from "../lib/form-component-sync.js"
import { getEnabledFormFields, mergeFormFieldsOnComponentSync } from "../lib/site-form-fields.js"
import {
  fieldsSchemaSchema,
  normalizeFieldsSchema,
  validateFieldValues,
  type DataFieldDefinition,
} from "../lib/data-model.js"
import { syncSiteWorkspaceRouting } from "../lib/site-routing-sync.js"
import { slugify } from "../lib/slug.js"
import type { Db } from "./index.js"
import {
  siteFormSubmissions,
  siteForms,
  sites,
  type ApplicationStatus,
  type SiteFormSettings,
} from "./schema.js"
import { getSiteById } from "./sites.js"

async function assertSiteWorkspaceReady(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  if (site.cloneStatus !== "ready" || !site.workspacePath) {
    throw new Error("Site workspace is not ready")
  }

  return site
}

async function syncFormsToWorkspace(db: Db, env: Env, siteId: number) {
  await assertSiteWorkspaceReady(db, siteId)
  await syncSiteWorkspaceRouting(db, env, siteId)
}

async function ensureUniqueFormSlug(db: Db, siteId: number, name: string) {
  const baseSlug = slugify(name) || "form"
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const existing = await db
      .select({ slug: siteForms.slug })
      .from(siteForms)
      .where(eq(siteForms.siteId, siteId))

    if (!existing.some((item) => item.slug === slug)) {
      return slug
    }

    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

function mapFormResponse(form: typeof siteForms.$inferSelect) {
  return {
    id: String(form.id),
    slug: form.slug,
    name: form.name,
    description: form.description ?? "",
    fieldsSchema: form.fieldsSchema ?? [],
    settings: form.settings ?? {},
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  }
}

function mapSubmissionResponse(
  submission: typeof siteFormSubmissions.$inferSelect,
  form: typeof siteForms.$inferSelect,
  site: typeof sites.$inferSelect,
) {
  const data = submission.data ?? {}
  const summary = extractApplicationSummary(data)

  return {
    id: String(submission.id),
    siteId: String(submission.siteId),
    siteName: site.name,
    formId: String(submission.formId),
    formSlug: form.slug,
    formName: form.name,
    name: summary.name,
    email: summary.email,
    phone: summary.phone,
    data,
    status: submission.status as ApplicationStatus,
    pageUrl: submission.pageUrl ?? "",
    submittedAt: submission.submittedAt,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  }
}

export async function getFormsForGeneration(db: Db, siteId: number) {
  const forms = await db
    .select()
    .from(siteForms)
    .where(eq(siteForms.siteId, siteId))
    .orderBy(asc(siteForms.name))

  return forms.map((form) => ({
    slug: form.slug,
    name: form.name,
    description: form.description,
    fieldsSchema: getEnabledFormFields(form.fieldsSchema ?? [], form.settings),
    settings: {
      successMessage: form.settings?.successMessage ?? "Thank you! Your message has been sent.",
      redirectUrl: form.settings?.redirectUrl ?? "",
    },
  }))
}

export async function listSiteForms(db: Db, siteId: number) {
  const forms = await db
    .select()
    .from(siteForms)
    .where(eq(siteForms.siteId, siteId))
    .orderBy(asc(siteForms.name))

  return forms.map(mapFormResponse)
}

export async function getSiteForm(db: Db, siteId: number, formId: number) {
  const [form] = await db
    .select()
    .from(siteForms)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.id, formId)))
    .limit(1)

  return form ? mapFormResponse(form) : null
}

export async function getSiteFormBySlug(db: Db, siteId: number, slug: string) {
  const [form] = await db
    .select()
    .from(siteForms)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.slug, slug)))
    .limit(1)

  return form ?? null
}

export async function createSiteForm(
  db: Db,
  env: Env,
  siteId: number,
  input: { name: string; slug?: string; description?: string },
) {
  const site = await getSiteById(db, siteId)
  if (!site) {
    throw new Error("Site not found")
  }

  const slug = input.slug?.trim() || (await ensureUniqueFormSlug(db, siteId, input.name))
  const timestamp = new Date().toISOString()

  const [form] = await db
    .insert(siteForms)
    .values({
      siteId,
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      fieldsSchema: DEFAULT_CONTACT_FORM_FIELDS,
      settings: {
        successMessage: "Thank you! Your message has been sent.",
        honeypotField: "_gotcha",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!form) {
    throw new Error("Failed to create form")
  }

  if (site.cloneStatus === "ready" && site.workspacePath) {
    await syncFormsToWorkspace(db, env, siteId)
  }

  return mapFormResponse(form)
}

export async function updateSiteForm(
  db: Db,
  env: Env,
  siteId: number,
  formId: number,
  input: {
    name?: string
    slug?: string
    description?: string
    fieldsSchema?: DataFieldDefinition[]
    settings?: SiteFormSettings
  },
) {
  const [existing] = await db
    .select()
    .from(siteForms)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.id, formId)))
    .limit(1)

  if (!existing) {
    return null
  }

  const patch: Partial<typeof siteForms.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  }

  if (input.name !== undefined) {
    patch.name = input.name.trim()
  }

  if (input.slug !== undefined) {
    patch.slug = input.slug.trim()
  }

  if (input.description !== undefined) {
    patch.description = input.description.trim() || null
  }

  if (input.fieldsSchema !== undefined) {
    patch.fieldsSchema = normalizeFieldsSchema(fieldsSchemaSchema.parse(input.fieldsSchema))
  }

  if (input.settings !== undefined) {
    patch.settings = {
      ...(existing.settings ?? {}),
      ...input.settings,
    }
  }

  const [form] = await db
    .update(siteForms)
    .set(patch)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.id, formId)))
    .returning()

  if (!form) {
    return null
  }

  const site = await getSiteById(db, siteId)
  if (site?.cloneStatus === "ready" && site.workspacePath) {
    await syncFormsToWorkspace(db, env, siteId)
  }

  return mapFormResponse(form)
}

export async function deleteSiteForm(db: Db, env: Env, siteId: number, formId: number) {
  const [existing] = await db
    .select({ id: siteForms.id })
    .from(siteForms)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.id, formId)))
    .limit(1)

  if (!existing) {
    return false
  }

  await db.delete(siteForms).where(and(eq(siteForms.siteId, siteId), eq(siteForms.id, formId)))

  const site = await getSiteById(db, siteId)
  if (site?.cloneStatus === "ready" && site.workspacePath) {
    await syncFormsToWorkspace(db, env, siteId)
  }

  return true
}

export async function listSiteApplications(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)
  if (!site) {
    throw new Error("Site not found")
  }

  const rows = await db
    .select({
      submission: siteFormSubmissions,
      form: siteForms,
    })
    .from(siteFormSubmissions)
    .innerJoin(siteForms, eq(siteFormSubmissions.formId, siteForms.id))
    .where(eq(siteFormSubmissions.siteId, siteId))
    .orderBy(desc(siteFormSubmissions.submittedAt))

  return rows.map(({ submission, form }) => mapSubmissionResponse(submission, form, site))
}

export async function listAllApplications(db: Db) {
  const rows = await db
    .select({
      submission: siteFormSubmissions,
      form: siteForms,
      site: sites,
    })
    .from(siteFormSubmissions)
    .innerJoin(siteForms, eq(siteFormSubmissions.formId, siteForms.id))
    .innerJoin(sites, eq(siteFormSubmissions.siteId, sites.id))
    .orderBy(desc(siteFormSubmissions.submittedAt))

  return rows.map(({ submission, form, site }) => mapSubmissionResponse(submission, form, site))
}

export async function getApplication(db: Db, applicationId: number) {
  const [row] = await db
    .select({
      submission: siteFormSubmissions,
      form: siteForms,
      site: sites,
    })
    .from(siteFormSubmissions)
    .innerJoin(siteForms, eq(siteFormSubmissions.formId, siteForms.id))
    .innerJoin(sites, eq(siteFormSubmissions.siteId, sites.id))
    .where(eq(siteFormSubmissions.id, applicationId))
    .limit(1)

  if (!row) {
    return null
  }

  return mapSubmissionResponse(row.submission, row.form, row.site)
}

export async function updateApplicationStatus(
  db: Db,
  applicationId: number,
  status: ApplicationStatus,
  siteId?: number,
) {
  const conditions = [eq(siteFormSubmissions.id, applicationId)]
  if (siteId !== undefined) {
    conditions.push(eq(siteFormSubmissions.siteId, siteId))
  }

  const [existing] = await db
    .select()
    .from(siteFormSubmissions)
    .where(and(...conditions))
    .limit(1)

  if (!existing) {
    return null
  }

  const [updated] = await db
    .update(siteFormSubmissions)
    .set({
      status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(siteFormSubmissions.id, applicationId))
    .returning()

  if (!updated) {
    return null
  }

  return getApplication(db, updated.id)
}

export async function deleteApplication(db: Db, applicationId: number, siteId?: number) {
  const conditions = [eq(siteFormSubmissions.id, applicationId)]
  if (siteId !== undefined) {
    conditions.push(eq(siteFormSubmissions.siteId, siteId))
  }

  const [existing] = await db
    .select({ id: siteFormSubmissions.id })
    .from(siteFormSubmissions)
    .where(and(...conditions))
    .limit(1)

  if (!existing) {
    return false
  }

  await db.delete(siteFormSubmissions).where(eq(siteFormSubmissions.id, applicationId))
  return true
}

import { buildHealthCheckFormPayload } from "../lib/form-health-check.js"

export async function testSiteFormSubmitPipeline(
  db: Db,
  env: Env,
  siteId: number,
  formSlug: string,
) {
  const formRow = await getSiteFormBySlug(db, siteId, formSlug)
  if (!formRow) {
    throw new Error(`Form "${formSlug}" not found`)
  }

  const data = buildHealthCheckFormPayload(
    getEnabledFormFields(formRow.fieldsSchema ?? [], formRow.settings),
  )
  const result = await submitSiteForm(db, env, siteId, formSlug, {
    data,
    pageUrl: "cms://forms-health-check",
  })

  await deleteApplication(db, Number(result.submissionId), siteId)
  return result
}

export async function submitSiteForm(
  db: Db,
  env: Env,
  siteId: number,
  formSlug: string,
  input: {
    data: Record<string, unknown>
    pageUrl?: string
  },
) {
  const site = await getSiteById(db, siteId)
  if (!site) {
    throw new Error("Site not found")
  }

  const formRow = await getSiteFormBySlug(db, siteId, formSlug)
  if (!formRow) {
    throw new Error("Form not found")
  }

  const [formRecord] = await db
    .select()
    .from(siteForms)
    .where(and(eq(siteForms.siteId, siteId), eq(siteForms.slug, formSlug)))
    .limit(1)

  const settings = formRecord?.settings ?? {}
  const honeypotField = settings.honeypotField ?? "_gotcha"
  const honeypotValue = input.data[honeypotField]
  const isSpam =
    (typeof honeypotValue === "string" && honeypotValue.trim() !== "") ||
    (honeypotValue !== undefined && honeypotValue !== null && honeypotValue !== "")

  const fieldsSchema = getEnabledFormFields(formRow.fieldsSchema ?? [], formRecord?.settings)
  let normalizedData: Record<string, unknown> = {}

  if (!isSpam && fieldsSchema.length > 0) {
    normalizedData = validateFieldValues(fieldsSchema, input.data)
  } else if (!isSpam) {
    normalizedData = input.data
  }

  const timestamp = new Date().toISOString()
  const [submission] = await db
    .insert(siteFormSubmissions)
    .values({
      siteId,
      formId: Number(formRow.id),
      data: normalizedData,
      status: isSpam ? "spam" : "new",
      pageUrl: input.pageUrl?.trim() || null,
      submittedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()

  if (!submission) {
    throw new Error("Failed to save submission")
  }

  const notifyEmails = parseNotifyEmails(settings.notifyEmail)
  if (!isSpam && notifyEmails.length > 0) {
    try {
      await sendFormSubmissionEmail(env, site, {
        to: notifyEmails,
        siteName: site.name,
        formName: formRow.name,
        formSlug,
        submissionId: String(submission.id),
        pageUrl: input.pageUrl,
        data: normalizedData,
        fieldsSchema,
      })
    } catch (error) {
      console.error("[submitSiteForm] Failed to send notification email:", error)
    }
  }

  return {
    success: true,
    submissionId: String(submission.id),
    status: submission.status as ApplicationStatus,
    message: settings.successMessage ?? "Thank you! Your message has been sent.",
    redirectUrl: settings.redirectUrl ?? "",
  }
}

export async function syncSiteFormsFromBlocks(
  db: Db,
  env: Env,
  siteId: number,
  blocks: SiteFormBlockRef[],
) {
  const site = await getSiteById(db, siteId)
  if (!site || site.cloneStatus !== "ready" || !site.workspacePath) {
    return
  }

  if (blocks.length === 0) {
    return
  }

  const timestamp = new Date().toISOString()
  let changed = false

  for (const block of blocks) {
    const formSlug = typeof block.props.formSlug === "string" ? block.props.formSlug.trim() : ""
    if (!formSlug) {
      continue
    }

    const definition = await resolveFormDefinitionFromBlock(env, block)
    const existing = await getSiteFormBySlug(db, siteId, formSlug)

    if (existing) {
      const mergedFields = mergeFormFieldsOnComponentSync(definition.fieldsSchema, existing.settings)
      await db
        .update(siteForms)
        .set({
          fieldsSchema: mergedFields.fieldsSchema,
          settings: {
            ...existing.settings,
            successMessage: definition.settings.successMessage,
            redirectUrl: definition.settings.redirectUrl,
            honeypotField: definition.settings.honeypotField,
            disabledFieldKeys: mergedFields.disabledFieldKeys,
          },
          updatedAt: timestamp,
        })
        .where(eq(siteForms.id, existing.id))
      changed = true
      continue
    }

    await db.insert(siteForms).values({
      siteId,
      slug: formSlug,
      name: humanizeFormSlug(formSlug),
      description: null,
      fieldsSchema: definition.fieldsSchema,
      settings: {
        ...definition.settings,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    changed = true
  }

  if (changed) {
    await syncFormsToWorkspace(db, env, siteId)
  }
}

export async function syncFormComponentToLinkedSites(
  db: Db,
  env: Env,
  componentId: number,
  componentSlug: string,
  usage: Array<{
    siteId: number
    variantSlug: string
    props: Record<string, unknown>
  }>,
) {
  const blocksBySite = new Map<number, SiteFormBlockRef[]>()

  for (const item of usage) {
    const formSlug = typeof item.props.formSlug === "string" ? item.props.formSlug.trim() : ""
    if (!formSlug) {
      continue
    }

    const blocks = blocksBySite.get(item.siteId) ?? []
    blocks.push({
      componentId,
      componentSlug,
      variantSlug: item.variantSlug,
      props: item.props,
    })
    blocksBySite.set(item.siteId, blocks)
  }

  for (const [siteId, blocks] of blocksBySite) {
    await syncSiteFormsFromBlocks(db, env, siteId, blocks)
  }

  const siteIds = [...blocksBySite.keys()]
  await Promise.all(siteIds.map((siteId) => syncSiteWorkspaceRouting(db, env, siteId)))
}

export async function ensureSiteFormsForSlugs(
  db: Db,
  env: Env,
  siteId: number,
  slugs: string[],
) {
  const site = await getSiteById(db, siteId)
  if (!site || site.cloneStatus !== "ready" || !site.workspacePath) {
    return
  }

  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))]
  if (uniqueSlugs.length === 0) {
    return
  }

  let created = false
  const timestamp = new Date().toISOString()

  for (const slug of uniqueSlugs) {
    const existing = await getSiteFormBySlug(db, siteId, slug)
    if (existing) {
      continue
    }

    await db.insert(siteForms).values({
      siteId,
      slug,
      name: humanizeFormSlug(slug),
      description: null,
      fieldsSchema: DEFAULT_CONTACT_FORM_FIELDS,
      settings: {
        successMessage: "Thank you! Your message has been sent.",
        honeypotField: "_gotcha",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    created = true
  }

  if (created) {
    await syncFormsToWorkspace(db, env, siteId)
  }
}

export { collectFormSlugsFromBlocks }
