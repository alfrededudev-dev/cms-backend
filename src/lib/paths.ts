import path from "node:path"
import { fileURLToPath } from "node:url"
import { variantSlugToFileName } from "./slug.js"

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function resolveWorkspacesDir(workspacesDir: string) {
  return path.isAbsolute(workspacesDir) ? workspacesDir : path.resolve(backendRoot, workspacesDir)
}

export function getSiteWorkspacePath(workspacesDir: string, siteId: number) {
  return path.join(resolveWorkspacesDir(workspacesDir), `site-${siteId}`)
}

export function resolveSiteWorkspacePath(
  workspacesDir: string,
  siteId: number,
  storedPath?: string | null,
) {
  const canonical = path.normalize(getSiteWorkspacePath(workspacesDir, siteId))

  if (!storedPath?.trim()) {
    return canonical
  }

  const stored = path.isAbsolute(storedPath.trim())
    ? path.normalize(storedPath.trim())
    : path.normalize(path.resolve(resolveWorkspacesDir(workspacesDir), storedPath.trim()))

  return stored === canonical ? stored : canonical
}

export function resolveComponentPreviewDir(componentPreviewDir: string) {
  return path.isAbsolute(componentPreviewDir)
    ? componentPreviewDir
    : path.resolve(backendRoot, componentPreviewDir)
}

export function resolveAstroStarterDir(astroStarterDir: string) {
  return path.isAbsolute(astroStarterDir)
    ? astroStarterDir
    : path.resolve(backendRoot, astroStarterDir)
}

export function resolveComponentPreviewAssetsDir(componentPreviewAssetsDir: string) {
  return path.isAbsolute(componentPreviewAssetsDir)
    ? componentPreviewAssetsDir
    : path.resolve(backendRoot, componentPreviewAssetsDir)
}

export function getComponentBlocksDir(componentPreviewDir: string) {
  return path.join(resolveComponentPreviewDir(componentPreviewDir), "src", "components", "blocks")
}

export function getComponentDir(componentPreviewDir: string, componentSlug: string) {
  return path.join(getComponentBlocksDir(componentPreviewDir), componentSlug)
}

export function getVariantFilePath(componentPreviewDir: string, componentSlug: string, variantSlug: string) {
  return path.join(getComponentDir(componentPreviewDir, componentSlug), variantSlugToFileName(variantSlug))
}

export function getPreviewJsonPath(componentPreviewDir: string, componentSlug: string) {
  return path.join(getComponentDir(componentPreviewDir, componentSlug), "preview.json")
}

export function getComponentDevUrl(host: string, port: number) {
  return `http://${host}:${port}`
}

/** Path prefix for Astro `base` when preview is reverse-proxied under a subpath. */
export function getComponentPreviewBasePath(publicUrl: string | undefined) {
  const raw = publicUrl?.trim()
  if (!raw) {
    return "/"
  }

  try {
    const pathname = new URL(raw).pathname
    if (!pathname || pathname === "/") {
      return "/"
    }

    return pathname.endsWith("/") ? pathname : `${pathname}/`
  } catch {
    return "/"
  }
}

/** Origin only (scheme + host), used for Vite HMR behind HTTPS proxy. */
export function getComponentPreviewPublicOrigin(publicUrl: string | undefined) {
  const raw = publicUrl?.trim()
  if (!raw) {
    return null
  }

  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/**
 * Hostnames Vite/Astro should accept behind nginx.
 * - `true` / `*` in allowedHostsEnv → allow all
 * - otherwise merge PUBLIC_URL hostname + comma-separated list
 */
export function getComponentPreviewAllowedHosts(
  publicUrl: string | undefined,
  allowedHostsEnv: string | undefined,
): true | string[] {
  const raw = allowedHostsEnv?.trim()
  if (raw === "true" || raw === "*") {
    return true
  }

  const hosts = new Set<string>()

  if (raw) {
    for (const host of raw.split(",")) {
      const value = host.trim()
      if (value) {
        hosts.add(value)
      }
    }
  }

  const origin = getComponentPreviewPublicOrigin(publicUrl)
  if (origin) {
    try {
      hosts.add(new URL(origin).hostname)
    } catch {
      // ignore
    }
  }

  return [...hosts]
}

/** URL the API uses to probe whether Astro is up (always host:port on the server). */
export function getComponentPreviewInternalUrl(host: string, port: number, publicUrl?: string) {
  const root = getComponentDevUrl(host, port)
  const base = getComponentPreviewBasePath(publicUrl)
  if (base === "/") {
    return root
  }

  return `${root}${base.replace(/\/$/, "")}`
}

/** URL the browser/iframe should use (HTTPS public URL when configured). */
export function getComponentPreviewPublicUrl(host: string, port: number, publicUrl?: string) {
  const raw = publicUrl?.trim().replace(/\/$/, "")
  if (raw) {
    return raw
  }

  return getComponentDevUrl(host, port)
}

