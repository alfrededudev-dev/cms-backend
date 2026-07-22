export const componentKinds = ["template", "layout", "form"] as const

export type ComponentKind = (typeof componentKinds)[number]

export const DEFAULT_COMPONENT_KIND: ComponentKind = "template"

export function isComponentKind(value: string): value is ComponentKind {
  return (componentKinds as readonly string[]).includes(value)
}

/** Components allowed on site page templates (static + collection list pages). */
export const pageTemplateComponentKinds = ["template", "form"] as const satisfies readonly ComponentKind[]

export function isPageTemplateComponentKind(kind: ComponentKind) {
  return kind === "template" || kind === "form"
}
