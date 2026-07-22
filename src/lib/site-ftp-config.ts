import type { Client } from "basic-ftp"
import type { Site } from "../db/schema.js"

export type FtpConnectionConfig = {
  host: string
  port: number
  username: string
  password: string
  remotePath: string
  secure: boolean
}

function normalizeRemotePath(remotePath: string) {
  const trimmed = remotePath.trim() || "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

export function normalizeFtpHost(input: string) {
  let value = input.trim()

  if (!value) {
    return { host: "", port: undefined as number | undefined, remotePath: undefined as string | undefined }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return {
        host: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        remotePath: url.pathname && url.pathname !== "/" ? normalizeRemotePath(url.pathname) : undefined,
      }
    } catch {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    }
  }

  value = value.replace(/^(ftp|ftps|sftp):\/\//i, "")

  let remotePath: string | undefined
  const slashIndex = value.indexOf("/")
  if (slashIndex > 0) {
    remotePath = normalizeRemotePath(value.slice(slashIndex))
    value = value.slice(0, slashIndex)
  }

  value = value.replace(/\/+$/, "")

  const ipv6Match = value.match(/^\[(.+)\](?::(\d+))?$/)
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: ipv6Match[2] ? Number(ipv6Match[2]) : undefined,
      remotePath,
    }
  }

  const hostPortMatch = value.match(/^([^:]+):(\d+)$/)
  if (hostPortMatch) {
    return {
      host: hostPortMatch[1],
      port: Number(hostPortMatch[2]),
      remotePath,
    }
  }

  return { host: value, port: undefined, remotePath }
}

export function normalizeSshHost(input: string) {
  return normalizeFtpHost(input.replace(/^ssh:\/\//i, "sftp://"))
}

export function resolveSiteFtpConfig(
  site: Site,
  overrides?: Partial<Omit<FtpConnectionConfig, "password">> & { password?: string },
): FtpConnectionConfig {
  const rawHost = overrides?.host?.trim() || site.ftpHost?.trim() || ""
  const normalizedHost = normalizeFtpHost(rawHost)
  const host = normalizedHost.host
  const username = overrides?.username?.trim() || site.ftpUsername?.trim()
  const password =
    overrides?.password !== undefined && overrides.password !== ""
      ? overrides.password
      : site.ftpPassword ?? ""
  const remotePath =
    overrides?.remotePath?.trim() ||
    site.ftpRemotePath?.trim() ||
    normalizedHost.remotePath ||
    "/"
  const port = overrides?.port ?? normalizedHost.port ?? site.ftpPort ?? 21
  const secure = overrides?.secure ?? site.ftpSecure ?? false

  if (!host) {
    throw new Error("FTP host is required")
  }

  if (!username) {
    throw new Error("FTP username is required")
  }

  if (!password) {
    throw new Error("FTP password is required")
  }

  return {
    host,
    port,
    username,
    password,
    remotePath: normalizeRemotePath(remotePath),
    secure,
  }
}

async function loadBasicFtpClient() {
  try {
    const module = await import("basic-ftp")
    return module.Client
  } catch {
    throw new Error("FTP module is missing. Run npm install in the backend folder and restart the API server.")
  }
}

export async function createFtpClient(timeoutMs = 30_000) {
  const Client = await loadBasicFtpClient()
  const client = new Client(timeoutMs)
  client.ftp.verbose = false
  return client
}

export async function withFtpClient<T>(config: FtpConnectionConfig, action: (client: Client) => Promise<T>) {
  const client = await createFtpClient()

  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.secure,
    })

    return await action(client)
  } finally {
    client.close()
  }
}
