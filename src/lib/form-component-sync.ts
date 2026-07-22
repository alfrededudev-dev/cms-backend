import { getVariantPreviewProps, readPreviewJson, readVariantPropsSchema } from "./component-files.js"
import { normalizeFormFieldsFromProp, type DataFieldDefinition } from "./data-model.js"
import { DEFAULT_CONTACT_FORM_FIELDS } from "./site-form-defaults.js"
import type { Env } from "../env.js"

export type SiteFormBlockRef = {
  componentId: number
  componentSlug: string
  variantSlug: string
  props: Record<string, unknown>
}

export function parseFormFieldsProp(value: unknown) {
  return normalizeFormFieldsFromProp(value)
}

export async function resolveFormDefinitionFromBlock(
  env: Env,
  block: SiteFormBlockRef,
): Promise<{
  fieldsSchema: DataFieldDefinition[]
  settings: {
    successMessage: string
    redirectUrl: string
    honeypotField: string
  }
}> {
  const preview = await readPreviewJson(env.COMPONENT_PREVIEW_DIR, block.componentSlug)
  const schema = await readVariantPropsSchema(
    env.COMPONENT_PREVIEW_DIR,
    block.componentSlug,
    block.variantSlug,
  )
  const previewProps = getVariantPreviewProps(preview, block.variantSlug, schema)
  const { fields: _staleBlockFields, ...blockOverrides } = block.props
  const mergedProps = { ...previewProps, ...blockOverrides }

  const fieldsFromProps = normalizeFormFieldsFromProp(mergedProps.fields)
  const successMessage =
    typeof mergedProps.successMessage === "string" && mergedProps.successMessage.trim()
      ? mergedProps.successMessage.trim()
      : "Thank you! Your message has been sent."
  const redirectUrl =
    typeof mergedProps.redirectUrl === "string" ? mergedProps.redirectUrl.trim() : ""

  return {
    fieldsSchema: fieldsFromProps.length > 0 ? fieldsFromProps : DEFAULT_CONTACT_FORM_FIELDS,
    settings: {
      successMessage,
      redirectUrl,
      honeypotField: "_gotcha",
    },
  }
}
