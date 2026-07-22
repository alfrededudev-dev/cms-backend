import type { SiteFormSettings } from "../db/schema.js"
import type { DataFieldDefinition } from "./data-model.js"

export function getDisabledFieldKeys(settings: SiteFormSettings | undefined | null) {
  return new Set(settings?.disabledFieldKeys ?? [])
}

export function getEnabledFormFields(
  fieldsSchema: DataFieldDefinition[],
  settings: SiteFormSettings | undefined | null,
) {
  const disabled = getDisabledFieldKeys(settings)
  return fieldsSchema.filter((field) => !disabled.has(field.key))
}

export function mergeFormFieldsOnComponentSync(
  incomingFields: DataFieldDefinition[],
  existingSettings: SiteFormSettings | undefined | null,
) {
  const incomingKeys = new Set(incomingFields.map((field) => field.key))
  const disabledFieldKeys = (existingSettings?.disabledFieldKeys ?? []).filter((key) =>
    incomingKeys.has(key),
  )

  return {
    fieldsSchema: incomingFields,
    disabledFieldKeys,
  }
}
