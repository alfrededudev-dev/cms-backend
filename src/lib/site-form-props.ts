import type { DataFieldDefinition } from "./data-model.js"
import { collectFormSlugsFromProps } from "./site-form-defaults.js"

export type GeneratedFormDefinition = {
  slug: string
  name: string
  description?: string | null
  fieldsSchema: DataFieldDefinition[]
  settings: {
    successMessage?: string
    redirectUrl?: string
    honeypotField?: string
  }
}

export function buildFormSubmitUrl(apiBase: string, siteId: number, formSlug: string) {
  const normalizedApiBase = apiBase.replace(/\/$/, "")
  return `${normalizedApiBase}/api/public/sites/${siteId}/forms/${formSlug}/submit`
}

export function enrichBlockPropsWithFormData(
  props: Record<string, unknown>,
  formsBySlug: Map<string, GeneratedFormDefinition>,
  siteId: number,
  apiBase: string,
) {
  const formSlug = typeof props.formSlug === "string" ? props.formSlug.trim() : ""
  if (!formSlug) {
    return props
  }

  const form = formsBySlug.get(formSlug)
  if (!form) {
    return props
  }

  return {
    ...props,
    submitUrl: buildFormSubmitUrl(apiBase, siteId, formSlug),
    fields: form.fieldsSchema,
    successMessage: form.settings.successMessage ?? "Thank you! Your message has been sent.",
    redirectUrl: form.settings.redirectUrl ?? "",
  }
}

export function enrichBlocksWithFormData<T extends { props: Record<string, unknown> }>(
  blocks: T[],
  forms: GeneratedFormDefinition[],
  siteId: number,
  apiBase: string,
) {
  const formsBySlug = new Map(forms.map((form) => [form.slug, form]))

  return blocks.map((block) => ({
    ...block,
    props: enrichBlockPropsWithFormData(block.props, formsBySlug, siteId, apiBase),
  }))
}

export function collectFormSlugsFromBlockProps(props: Record<string, unknown>) {
  return collectFormSlugsFromProps(props)
}
