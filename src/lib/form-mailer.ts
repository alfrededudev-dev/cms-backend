import nodemailer from "nodemailer"
import type { DataFieldDefinition } from "./data-model.js"
import { resolveSmtpConfig, type SiteSmtpConfig } from "./site-smtp.js"
import type { Env } from "../env.js"
import type { Site } from "../db/schema.js"

function createTransport(config: SiteSmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth:
      config.user && config.password
        ? {
            user: config.user,
            pass: config.password,
          }
        : undefined,
  })
}

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—"
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

function buildSubmissionLines(
  data: Record<string, unknown>,
  fieldsSchema: DataFieldDefinition[],
) {
  const lines: Array<{ label: string; value: string }> = []

  if (fieldsSchema.length > 0) {
    for (const field of fieldsSchema) {
      lines.push({
        label: field.label || field.key,
        value: formatFieldValue(data[field.key]),
      })
    }
    return lines
  }

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) {
      continue
    }

    lines.push({
      label: key,
      value: formatFieldValue(value),
    })
  }

  return lines
}

export async function sendFormSubmissionEmail(
  env: Env,
  site: Site,
  input: {
    to: string | string[]
    siteName: string
    formName: string
    formSlug: string
    submissionId: string
    pageUrl?: string | null
    data: Record<string, unknown>
    fieldsSchema: DataFieldDefinition[]
  },
) {
  const smtpConfig = resolveSmtpConfig(site, env)

  if (!smtpConfig) {
    console.warn("[form-mailer] SMTP is not configured — skipping notification email")
    return { sent: false as const, reason: "smtp_not_configured" as const }
  }

  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean)
  if (recipients.length === 0) {
    return { sent: false as const, reason: "no_recipients" as const }
  }

  const transport = createTransport(smtpConfig)
  const lines = buildSubmissionLines(input.data, input.fieldsSchema)
  const textBody = [
    `New submission for "${input.formName}" (${input.formSlug}) on ${input.siteName}`,
    `Submission ID: ${input.submissionId}`,
    input.pageUrl ? `Page: ${input.pageUrl}` : null,
    "",
    ...lines.map((line) => `${line.label}: ${line.value}`),
  ]
    .filter(Boolean)
    .join("\n")

  const htmlBody = `
    <h2>New form submission</h2>
    <p><strong>Site:</strong> ${input.siteName}</p>
    <p><strong>Form:</strong> ${input.formName} (<code>${input.formSlug}</code>)</p>
    <p><strong>Submission ID:</strong> ${input.submissionId}</p>
    ${input.pageUrl ? `<p><strong>Page:</strong> <a href="${input.pageUrl}">${input.pageUrl}</a></p>` : ""}
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;margin-top:16px">
      <tbody>
        ${lines
          .map(
            (line) =>
              `<tr><th align="left">${line.label}</th><td>${line.value.replace(/\n/g, "<br>")}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `

  await transport.sendMail({
    from: smtpConfig.from,
    to: recipients.join(", "),
    subject: `[${input.siteName}] ${input.formName} — new submission`,
    text: textBody,
    html: htmlBody,
  })

  return { sent: true as const }
}

export async function verifySiteSmtpConfig(env: Env, site: Site) {
  const smtpConfig = resolveSmtpConfig(site, env)

  if (!smtpConfig) {
    throw new Error("SMTP is not configured. Set site SMTP settings or backend SMTP env vars.")
  }

  const transport = createTransport(smtpConfig)
  await transport.verify()
  return { ok: true as const }
}
