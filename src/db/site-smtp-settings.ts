import { eq } from "drizzle-orm"
import type { Db } from "./index.js"
import { sites } from "./schema.js"
import { getSiteById } from "./sites.js"
import { verifySiteSmtpConfig } from "../lib/form-mailer.js"
import type { Env } from "../env.js"

export function mapSiteSmtpResponse(site: {
  smtpHost: string | null
  smtpPort: number
  smtpUser: string | null
  smtpPassword: string | null
  smtpFrom: string | null
  smtpSecure: boolean
}) {
  return {
    host: site.smtpHost ?? "",
    port: site.smtpPort ?? 587,
    user: site.smtpUser ?? "",
    from: site.smtpFrom ?? "",
    secure: site.smtpSecure ?? false,
    hasPassword: Boolean(site.smtpPassword),
  }
}

export async function getSiteSmtpSettings(db: Db, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  return mapSiteSmtpResponse(site)
}

export async function updateSiteSmtpSettings(
  db: Db,
  siteId: number,
  input: {
    host?: string
    port?: number
    user?: string
    password?: string | null
    from?: string
    secure?: boolean
  },
) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  const patch: Partial<typeof sites.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  }

  if (input.host !== undefined) {
    patch.smtpHost = input.host.trim() || null
  }

  if (input.port !== undefined) {
    patch.smtpPort = input.port
  }

  if (input.user !== undefined) {
    patch.smtpUser = input.user.trim() || null
  }

  if (input.password !== undefined) {
    patch.smtpPassword = input.password?.trim() || null
  }

  if (input.from !== undefined) {
    patch.smtpFrom = input.from.trim() || null
  }

  if (input.secure !== undefined) {
    patch.smtpSecure = input.secure
  }

  const [updatedSite] = await db.update(sites).set(patch).where(eq(sites.id, siteId)).returning()

  if (!updatedSite) {
    throw new Error("Failed to update SMTP settings")
  }

  return mapSiteSmtpResponse(updatedSite)
}

export async function testSiteSmtpSettings(db: Db, env: Env, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new Error("Site not found")
  }

  await verifySiteSmtpConfig(env, site)
  return { ok: true as const }
}
