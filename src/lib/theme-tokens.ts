import type { ThemeColorToken } from "../db/schema.js"

/** All theme color tokens components may reference via Tailwind (bg-primary, text-accent, …). */
export const CANONICAL_THEME_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "foreground",
  "muted",
  "border",
  "bg-light",
  "bg-dark",
] as const

export type CanonicalThemeColorKey = (typeof CANONICAL_THEME_COLOR_KEYS)[number]

export type ThemeColorMapping = Partial<Record<CanonicalThemeColorKey, string>>

export function normalizeThemeColorKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export const COMPONENT_PREVIEW_THEME_COLORS: ThemeColorToken[] = [
  { key: "primary", value: "#3b82f6" },
  { key: "secondary", value: "#8b5cf6" },
  { key: "accent", value: "#f59e0b" },
  { key: "background", value: "#ffffff" },
  { key: "foreground", value: "#1e293b" },
  { key: "muted", value: "#f1f5f9" },
  { key: "border", value: "#e2e8f0" },
  { key: "bg-light", value: "#f8fafc" },
  { key: "bg-dark", value: "#0f172a" },
]

export function themeCssVarName(key: string) {
  return `--site-color-${key}`
}

export function buildThemeCssFromKeys(keys: readonly string[]) {
  if (keys.length === 0) {
    return "/* CMS theme — no color tokens */\n"
  }

  const themeLines = keys.map((key) => `  --color-${key}: var(${themeCssVarName(key)});`)

  return `@theme inline {\n${themeLines.join("\n")}\n}\n`
}

export function buildThemeHeadStyles(colors: ThemeColorToken[]) {
  if (colors.length === 0) {
    return ""
  }

  const rootVars = colors.map((color) => `${themeCssVarName(color.key)}:${color.value};`).join("")

  return `<style is:inline>:root{${rootVars}}</style>`
}

export function buildThemeJsonPayload(colors: ThemeColorToken[]) {
  return {
    colors,
    headStylesHtml: buildThemeHeadStyles(colors),
    tailwindClasses: colors.map((color) => ({
      key: color.key,
      background: `bg-${color.key}`,
      text: `text-${color.key}`,
      border: `border-${color.key}`,
    })),
  }
}

export function ensureCanonicalThemeColors(colors: ThemeColorToken[]): ThemeColorToken[] {
  const byKey = new Map<string, string>()

  for (const color of COMPONENT_PREVIEW_THEME_COLORS) {
    byKey.set(color.key, color.value)
  }

  for (const color of colors) {
    const key = normalizeThemeColorKey(color.key)

    if (key) {
      byKey.set(key, color.value)
    }
  }

  return CANONICAL_THEME_COLOR_KEYS.map((key) => ({
    key,
    value: byKey.get(key) ?? COMPONENT_PREVIEW_THEME_COLORS.find((item) => item.key === key)?.value ?? "#000000",
  }))
}

export function normalizeThemeColorMapping(value: unknown): ThemeColorMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const mapping: ThemeColorMapping = {}

  for (const [rawKey, rawTarget] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeThemeColorKey(rawKey) as CanonicalThemeColorKey

    if (!(CANONICAL_THEME_COLOR_KEYS as readonly string[]).includes(key)) {
      continue
    }

    const target = String(rawTarget ?? "").trim()

    if (!target || target === "default") {
      continue
    }

    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(target)) {
      mapping[key] = target
      continue
    }

    const alias = normalizeThemeColorKey(target)

    if (alias) {
      mapping[key] = alias
    }
  }

  return mapping
}

/** Scoped CSS variables for a single block instance (maps component tokens → site tokens or hex). */
export function buildBlockThemeScopeStyle(mapping: ThemeColorMapping) {
  const parts: string[] = []

  for (const [token, target] of Object.entries(mapping)) {
    if (!target) {
      continue
    }

    if (target.startsWith("#")) {
      parts.push(`${themeCssVarName(token)}:${target}`)
      continue
    }

    parts.push(`${themeCssVarName(token)}:var(${themeCssVarName(target)})`)
  }

  return parts.join(";")
}
