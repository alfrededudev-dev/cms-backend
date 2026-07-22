export type ApplicationSummary = {
  name: string
  email: string
  phone: string
}

const NAME_KEYS = ["name", "full_name", "fullname", "first_name", "contact_name", "title"]
const EMAIL_KEYS = ["email", "e_mail", "mail", "contact_email"]
const PHONE_KEYS = ["phone", "tel", "telephone", "mobile", "phone_number"]

function pickString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

export function extractApplicationSummary(data: Record<string, unknown>): ApplicationSummary {
  return {
    name: pickString(data, NAME_KEYS) || "—",
    email: pickString(data, EMAIL_KEYS) || "—",
    phone: pickString(data, PHONE_KEYS) || "—",
  }
}
