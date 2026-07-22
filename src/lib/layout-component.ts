import type { ComponentKind } from "./component-kind.js"

export const COMPONENT_KIND_META_KEY = "_kind"

export function layoutComponentHasSlot(code: string) {
  return /<slot(\s|\/?>|>)/i.test(code)
}

export function assertLayoutComponentHasSlot(code: string) {
  if (!layoutComponentHasSlot(code)) {
    throw new Error("Layout components must include a <slot /> where page template content renders.")
  }
}

export function isPreviewMetaKey(key: string) {
  return key.startsWith("_")
}

export function previewPropsFromRaw(raw: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !isPreviewMetaKey(key)))
}

export function componentKindFromPreviewMeta(
  preview: Record<string, unknown>,
  fallback: ComponentKind = "template",
): ComponentKind {
  const kind = preview[COMPONENT_KIND_META_KEY]
  return kind === "layout" || kind === "form" || kind === "template" ? kind : fallback
}
