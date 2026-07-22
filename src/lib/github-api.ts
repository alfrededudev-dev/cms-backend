export type GitHubRepository = {
  htmlUrl: string
  cloneUrl: string
  fullName: string
  defaultBranch: string
}

export type GitHubTokenVerification = {
  valid: true
  login: string
  name: string | null
  tokenType: "classic" | "fine-grained" | "unknown"
  scopes: string[]
  canCreateRepositories: boolean
  warnings: string[]
}

type GitHubErrorBody = {
  message?: string
  documentation_url?: string
  errors?: Array<{ message?: string; code?: string; field?: string }>
}

function normalizeToken(token: string) {
  return token.trim()
}

function detectTokenType(token: string): GitHubTokenVerification["tokenType"] {
  if (token.startsWith("github_pat_")) return "fine-grained"
  if (token.startsWith("ghp_") || token.startsWith("gho_") || token.startsWith("ghu_")) return "classic"
  return "unknown"
}

function parseScopes(headerValue: string | null) {
  if (!headerValue) return [] as string[]
  return headerValue
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function canCreateRepositories(tokenType: GitHubTokenVerification["tokenType"], scopes: string[]) {
  if (tokenType === "fine-grained") {
    return false
  }

  return scopes.includes("repo") || scopes.includes("public_repo")
}

function buildTokenWarnings(
  tokenType: GitHubTokenVerification["tokenType"],
  scopes: string[],
  privateRepo: boolean,
) {
  const warnings: string[] = []

  if (tokenType === "fine-grained") {
    warnings.push(
      "Fine-grained tokens cannot create new repositories. Use a classic personal access token instead.",
    )
  }

  if (tokenType === "classic" && scopes.length === 0) {
    warnings.push("GitHub did not report token scopes. The token may be invalid or missing repository permissions.")
  }

  if (tokenType === "classic" && privateRepo && !scopes.includes("repo")) {
    warnings.push('Private repositories require the classic token scope "repo".')
  }

  if (tokenType === "classic" && !privateRepo && !scopes.includes("repo") && !scopes.includes("public_repo")) {
    warnings.push('Public repositories require the classic token scope "public_repo" or "repo".')
  }

  return warnings
}

function formatGitHubError(response: Response, data: GitHubErrorBody, input?: { private?: boolean; owner?: string }) {
  const privateRepo = input?.private ?? true
  const parts: string[] = []

  if (response.status === 401) {
    parts.push("GitHub rejected the token (401 Unauthorized).")
    parts.push("Check that the token is copied fully and has not expired.")
  } else if (response.status === 403) {
    parts.push(data.message ?? "GitHub rejected the request (403 Forbidden).")

    if (data.message?.toLowerCase().includes("resource not accessible")) {
      parts.push(
        "Fine-grained tokens usually cannot create repositories. Create a classic personal access token with repo scope.",
      )
    }

    if (input?.owner) {
      parts.push(`Creating repos in organization "${input.owner}" requires admin access to that organization.`)
    }
  } else if (response.status === 422) {
    parts.push(data.message ?? "GitHub rejected the repository settings (422).")

    for (const item of data.errors ?? []) {
      if (item.message) parts.push(item.message)
      else if (item.code) parts.push(item.code)
    }
  } else {
    parts.push(data.message ?? `GitHub API error (${response.status}).`)
  }

  if (privateRepo) {
    parts.push('Required for private repos: classic token with scope "repo".')
  } else {
    parts.push('Required for public repos: classic token with scope "public_repo" or "repo".')
  }

  return parts.join(" ")
}

export async function verifyGitHubToken(tokenInput: string, options?: { privateRepo?: boolean }) {
  const token = normalizeToken(tokenInput)
  const tokenType = detectTokenType(token)
  const privateRepo = options?.privateRepo ?? true

  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cms-backend",
    },
  })

  const data = (await response.json().catch(() => ({}))) as {
    login?: string
    name?: string | null
    message?: string
  }

  if (!response.ok) {
    throw new Error(formatGitHubError(response, data))
  }

  if (!data.login) {
    throw new Error("GitHub token verification returned an incomplete response")
  }

  const scopes = parseScopes(response.headers.get("x-oauth-scopes"))
  const warnings = buildTokenWarnings(tokenType, scopes, privateRepo)
  const canCreate = canCreateRepositories(tokenType, scopes)

  return {
    valid: true as const,
    login: data.login,
    name: data.name ?? null,
    tokenType,
    scopes,
    canCreateRepositories: canCreate,
    warnings,
  } satisfies GitHubTokenVerification
}

export async function createGitHubRepository(input: {
  token: string
  name: string
  private?: boolean
  description?: string
  owner?: string
}): Promise<GitHubRepository> {
  const token = normalizeToken(input.token)
  const privateRepo = input.private ?? true
  const verification = await verifyGitHubToken(token, { privateRepo })

  if (verification.tokenType === "fine-grained") {
    throw new Error(
      "Fine-grained tokens cannot create repositories. Create a classic personal access token with the repo scope.",
    )
  }

  if (verification.scopes.length > 0 && !verification.canCreateRepositories) {
    throw new Error(
      verification.warnings.join(" ") ||
        "This GitHub token is missing repository permissions. Use a classic token with repo scope.",
    )
  }

  const owner = input.owner?.trim()
  const url = owner
    ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`
    : "https://api.github.com/user/repos"

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cms-backend",
    },
    body: JSON.stringify({
      name: input.name.trim(),
      private: privateRepo,
      description: input.description?.trim() || undefined,
      auto_init: false,
    }),
  })

  const data = (await response.json().catch(() => ({}))) as GitHubErrorBody & {
    html_url?: string
    clone_url?: string
    full_name?: string
    default_branch?: string
  }

  if (!response.ok) {
    throw new Error(formatGitHubError(response, data, { private: privateRepo, owner }))
  }

  if (!data.html_url || !data.clone_url || !data.full_name) {
    throw new Error("GitHub returned an incomplete repository response")
  }

  return {
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
    fullName: data.full_name,
    defaultBranch: data.default_branch ?? "main",
  }
}
