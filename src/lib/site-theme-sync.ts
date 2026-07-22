import type { ThemeColorToken } from "../db/schema.js"
import {
  buildThemeCssFromKeys,
  buildThemeHeadStyles,
  buildThemeJsonPayload,
  CANONICAL_THEME_COLOR_KEYS,
  COMPONENT_PREVIEW_THEME_COLORS,
  ensureCanonicalThemeColors,
  normalizeThemeColorKey,
  themeCssVarName,
} from "./theme-tokens.js"

export {
  CANONICAL_THEME_COLOR_KEYS,
  COMPONENT_PREVIEW_THEME_COLORS,
  ensureCanonicalThemeColors,
  normalizeThemeColorKey,
  themeCssVarName,
}

export const DEFAULT_THEME_COLORS: ThemeColorToken[] = COMPONENT_PREVIEW_THEME_COLORS

export function normalizeThemeColors(colors: ThemeColorToken[]) {
  const normalized: ThemeColorToken[] = []
  const seen = new Set<string>()

  for (const color of colors) {
    const key = normalizeThemeColorKey(color.key)
    const value = color.value.trim()

    if (!key) {
      throw new Error("Each theme color needs a key")
    }

    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
      throw new Error(`Invalid color value for "${key}". Use hex format like #2563eb`)
    }

    if (seen.has(key)) {
      throw new Error(`Duplicate theme color key "${key}"`)
    }

    seen.add(key)
    normalized.push({ key, value })
  }

  return normalized
}

export function buildSiteThemeCss(colors: ThemeColorToken[]) {
  const canonical = ensureCanonicalThemeColors(colors)
  return buildThemeCssFromKeys(canonical.map((color) => color.key))
}

export function buildSiteThemeHeadStyles(colors: ThemeColorToken[]) {
  return buildThemeHeadStyles(ensureCanonicalThemeColors(colors))
}

export function buildSiteThemePayload(colors: ThemeColorToken[]) {
  const canonical = ensureCanonicalThemeColors(colors)
  return buildThemeJsonPayload(canonical)
}

export function getThemeColorsFromRecord(site: { themeColors: ThemeColorToken[] | null | undefined }) {
  const colors = site.themeColors ?? []
  return colors.length > 0 ? ensureCanonicalThemeColors(colors) : DEFAULT_THEME_COLORS
}

export function buildComponentPreviewThemePayload() {
  return buildThemeJsonPayload(COMPONENT_PREVIEW_THEME_COLORS)
}

export function buildComponentPreviewThemeCss() {
  return buildThemeCssFromKeys(CANONICAL_THEME_COLOR_KEYS)
}
