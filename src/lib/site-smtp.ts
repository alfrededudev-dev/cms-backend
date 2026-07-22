import type { Site } from "../db/schema.js"
import type { Env } from "../env.js"

export type SiteSmtpConfig = {
  host: string
  port: number
  user: string | null
  password: string | null
  from: string
  secure: boolean
}

export function getSiteSmtpConfigFromRecord(site: Site): SiteSmtpConfig | null {
  const host = site.smtpHost?.trim()
  const from = site.smtpFrom?.trim()

  if (!host || !from) {
    return null
  }

  return {
    host,
    port: site.smtpPort ?? 587,
    user: site.smtpUser?.trim() || null,
    password: site.smtpPassword?.trim() || null,
    from,
    secure: site.smtpSecure ?? false,
  }
}

export function getEnvSmtpConfig(env: Env): SiteSmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  const from = env.SMTP_FROM?.trim()

  if (!host || !from) {
    return null
  }

  return {
    host,
    port: env.SMTP_PORT ?? 587,
    user: env.SMTP_USER?.trim() || null,
    password: env.SMTP_PASS?.trim() || null,
    from,
    secure: env.SMTP_SECURE ?? false,
  }
}

export function resolveSmtpConfig(site: Site, env: Env): SiteSmtpConfig | null {
  return getSiteSmtpConfigFromRecord(site) ?? getEnvSmtpConfig(env)
}

export function isSmtpConfigured(site: Site, env: Env) {
  return resolveSmtpConfig(site, env) !== null
}

export function parseNotifyEmails(value: string | null | undefined) {
  if (!value?.trim()) {
    return []
  }

  return [...new Set(value.split(/[,;]/).map((item) => item.trim()).filter(Boolean))]
}
