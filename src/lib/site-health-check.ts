export type SiteHealthStatus = "online" | "offline" | "degraded"

export type SiteHealthCheckResult = {
  siteHealth: SiteHealthStatus
  checkedUrl: string
  statusCode: number | null
  responseTimeMs: number
  message: string
}

const CHECK_TIMEOUT_MS = 12_000

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "")
}

export function normalizeSiteCheckUrl(domain: string) {
  const trimmed = domain.trim()

  if (!trimmed) {
    throw new Error("Domain is required")
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return stripTrailingSlash(trimmed)
  }

  return stripTrailingSlash(`https://${trimmed.replace(/^\/+/, "")}`)
}

function classifyHealthStatus(statusCode: number | null): SiteHealthStatus {
  if (statusCode === null) {
    return "offline"
  }

  if (statusCode >= 200 && statusCode < 400) {
    return "online"
  }

  if (statusCode >= 400 && statusCode < 500) {
    return "degraded"
  }

  return "offline"
}

async function requestSiteHealth(url: string, method: "HEAD" | "GET") {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "CMS-SiteHealthCheck/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    })

    return {
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkSiteDomainHealth(domain: string): Promise<SiteHealthCheckResult> {
  const primaryUrl = normalizeSiteCheckUrl(domain)
  const fallbackUrl =
    primaryUrl.startsWith("https://") ? primaryUrl.replace(/^https:\/\//i, "http://") : null

  let lastError: string | null = null

  for (const url of [primaryUrl, fallbackUrl].filter(Boolean) as string[]) {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const { statusCode, responseTimeMs } = await requestSiteHealth(url, method)
        const siteHealth = classifyHealthStatus(statusCode)

        if (siteHealth === "online") {
          return {
            siteHealth,
            checkedUrl: url,
            statusCode,
            responseTimeMs,
            message: `Site responded with HTTP ${statusCode}`,
          }
        }

        if (siteHealth === "degraded") {
          return {
            siteHealth,
            checkedUrl: url,
            statusCode,
            responseTimeMs,
            message: `Site responded with HTTP ${statusCode}`,
          }
        }

        lastError = `HTTP ${statusCode}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Request failed"
      }
    }
  }

  return {
    siteHealth: "offline",
    checkedUrl: primaryUrl,
    statusCode: null,
    responseTimeMs: 0,
    message: lastError ?? "Site is unreachable",
  }
}
