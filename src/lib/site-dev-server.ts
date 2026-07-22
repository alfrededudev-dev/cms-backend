import { execFile, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { Env } from "../env.js"
import { killDevProcessTree } from "./process-tree.js"
import { plainTerminalEnv, sanitizeTerminalOutput } from "./terminal-sanitize.js"

const execFileAsync = promisify(execFile)

type DevStatus = "stopped" | "starting" | "running" | "failed"

export type SiteDevLogStream = "system" | "stdout" | "stderr"

export type SiteDevLogLine = {
  id: string
  timestamp: string
  stream: SiteDevLogStream
  message: string
}

type SiteDevEntry = {
  process: ChildProcess
  status: DevStatus
  error: string | null
  port: number
}

const MAX_LOG_LINES = 2000

const siteDevServers = new Map<number, SiteDevEntry>()
const siteDevLogs = new Map<number, SiteDevLogLine[]>()

let logSequence = 0

function createLogId() {
  logSequence += 1
  return `${Date.now()}-${logSequence}`
}

export function appendSiteDevLog(siteId: number, stream: SiteDevLogStream, message: string) {
  const trimmed = sanitizeTerminalOutput(message).trim()
  if (!trimmed) {
    return
  }

  const lines = siteDevLogs.get(siteId) ?? []
  const entries = trimmed.split(/\r?\n/).filter(Boolean)

  for (const entry of entries) {
    lines.push({
      id: createLogId(),
      timestamp: new Date().toISOString(),
      stream,
      message: entry,
    })
  }

  while (lines.length > MAX_LOG_LINES) {
    lines.shift()
  }

  siteDevLogs.set(siteId, lines)
}

function appendProcessOutput(siteId: number, stream: "stdout" | "stderr", chunk: Buffer) {
  appendSiteDevLog(siteId, stream, chunk.toString())
}

export function getSiteDevLogs(siteId: number, since?: string) {
  const logs = siteDevLogs.get(siteId) ?? []

  if (!since) {
    return logs
  }

  return logs.filter((line) => line.timestamp > since)
}

export function getSiteDevPort(env: Env, siteId: number) {
  return env.SITE_DEV_PORT_BASE + siteId
}

export function getSiteDevUrl(env: Env, siteId: number) {
  return `http://${env.SITE_DEV_HOST}:${getSiteDevPort(env, siteId)}`
}

export async function ensureNpmInstall(siteId: number, workspacePath: string) {
  try {
    await fs.access(path.join(workspacePath, "node_modules"))
    appendSiteDevLog(siteId, "system", "Dependencies already installed (node_modules found)")
    return
  } catch {
    appendSiteDevLog(siteId, "system", "Running npm install...")
  }

  try {
    const { stdout, stderr } = await execFileAsync("npm", ["install"], {
      cwd: workspacePath,
      shell: true,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (stdout) {
      appendSiteDevLog(siteId, "stdout", stdout)
    }

    if (stderr) {
      appendSiteDevLog(siteId, "stderr", stderr)
    }

    appendSiteDevLog(siteId, "system", "npm install completed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "npm install failed"
    appendSiteDevLog(siteId, "stderr", message)
    throw error
  }
}

async function waitForDevServer(siteId: number, url: string, timeoutMs = 90_000) {
  appendSiteDevLog(siteId, "system", `Waiting for dev server at ${url}...`)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" })
      if (response.ok || response.status === 404) {
        appendSiteDevLog(siteId, "system", "Dev server is responding")
        return
      }
    } catch {
      // server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error("Site dev server failed to start in time")
}

export function getSiteDevServerStatus(env: Env, siteId: number) {
  const entry = siteDevServers.get(siteId)

  return {
    status: entry?.status ?? "stopped",
    url: getSiteDevUrl(env, siteId),
    port: getSiteDevPort(env, siteId),
    error: entry?.error ?? null,
  }
}

export function getSiteDevServerSnapshot(env: Env, siteId: number, since?: string) {
  return {
    ...getSiteDevServerStatus(env, siteId),
    logs: getSiteDevLogs(siteId, since),
  }
}

async function clearAstroDevCache(workspacePath: string) {
  await fs.rm(path.join(workspacePath, ".astro"), { recursive: true, force: true }).catch(() => {})
  await fs.rm(path.join(workspacePath, "node_modules", ".vite"), { recursive: true, force: true }).catch(() => {})
}

export function isSiteDevServerActive(siteId: number) {
  const entry = siteDevServers.get(siteId)
  return entry?.status === "running" || entry?.status === "starting"
}

export function notifySiteDevServerWorkspaceUpdated(siteId: number) {
  if (!isSiteDevServerActive(siteId)) {
    return
  }

  appendSiteDevLog(
    siteId,
    "system",
    "Workspace updated — preview will refresh via hot reload.",
  )
}

export async function restartSiteDevServer(env: Env, siteId: number, workspacePath: string) {
  appendSiteDevLog(siteId, "system", "Restarting preview dev server...")

  if (isSiteDevServerActive(siteId)) {
    await stopSiteDevServer(siteId)
    await clearAstroDevCache(workspacePath)
    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  return ensureSiteDevServer(env, siteId, workspacePath)
}

export async function stopSiteDevServer(siteId: number) {
  const entry = siteDevServers.get(siteId)

  if (!entry) {
    return { status: "stopped" as const, error: null }
  }

  appendSiteDevLog(siteId, "system", "Stopping preview dev server...")
  entry.status = "stopped"
  siteDevServers.delete(siteId)
  await killDevProcessTree(entry.process)
  appendSiteDevLog(siteId, "system", "Preview dev server stopped")

  return { status: "stopped" as const, error: null }
}

export function clearSiteDevLogs(siteId: number) {
  siteDevLogs.delete(siteId)
}

export async function purgeSiteDevState(siteId: number) {
  await stopSiteDevServer(siteId)
  clearSiteDevLogs(siteId)
}

export async function ensureSiteDevServer(env: Env, siteId: number, workspacePath: string) {
  const url = getSiteDevUrl(env, siteId)
  const port = getSiteDevPort(env, siteId)
  const existing = siteDevServers.get(siteId)

  if (existing?.status === "running") {
    appendSiteDevLog(siteId, "system", `Preview server already running at ${url}`)
    return { status: existing.status, url, port, error: existing.error }
  }

  if (existing?.status === "starting") {
    appendSiteDevLog(siteId, "system", "Preview server is already starting, waiting...")
    await waitForDevServer(siteId, url)
    const entry = siteDevServers.get(siteId)
    if (entry) {
      entry.status = "running"
      entry.error = null
    }
    return { status: "running" as const, url, port, error: null }
  }

  appendSiteDevLog(siteId, "system", `Starting preview dev server for site #${siteId}`)
  appendSiteDevLog(siteId, "system", `Workspace: ${workspacePath}`)
  appendSiteDevLog(siteId, "system", `URL: ${url}`)

  await ensureNpmInstall(siteId, workspacePath)

  const command = `npm run dev -- --port ${port} --host`
  appendSiteDevLog(siteId, "system", `$ ${command}`)

  const devProcess = spawn("npm", ["run", "dev", "--", "--port", String(port), "--host"], {
    cwd: workspacePath,
    shell: true,
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      ...plainTerminalEnv,
    },
  })

  const entry: SiteDevEntry = {
    process: devProcess,
    status: "starting",
    error: null,
    port,
  }

  siteDevServers.set(siteId, entry)

  devProcess.stdout?.on("data", (chunk: Buffer) => {
    appendProcessOutput(siteId, "stdout", chunk)
  })

  devProcess.stderr?.on("data", (chunk: Buffer) => {
    appendProcessOutput(siteId, "stderr", chunk)
    const message = chunk.toString().trim()
    const current = siteDevServers.get(siteId)
    if (current && message) {
      current.error = message
    }
  })

  devProcess.on("exit", (code) => {
    const current = siteDevServers.get(siteId)
    if (!current) {
      return
    }

    if (current.status !== "stopped") {
      current.status = "failed"
      current.error = `Dev server exited with code ${code ?? "unknown"}`
      appendSiteDevLog(siteId, "system", current.error)
    }

    siteDevServers.delete(siteId)
  })

  try {
    await waitForDevServer(siteId, url)
    entry.status = "running"
    entry.error = null
    appendSiteDevLog(siteId, "system", `Preview ready at ${url}`)
  } catch (error) {
    entry.status = "failed"
    entry.error = error instanceof Error ? error.message : "Failed to start site dev server"
    appendSiteDevLog(siteId, "stderr", entry.error)
    await killDevProcessTree(devProcess)
    siteDevServers.delete(siteId)
    throw error
  }

  return { status: entry.status, url, port, error: entry.error }
}
