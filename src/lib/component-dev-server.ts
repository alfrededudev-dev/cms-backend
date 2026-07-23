import { execFile, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { Db } from "../db/index.js"
import type { Env } from "../env.js"
import { ensureComponentPreviewWorkspace } from "./component-preview-workspace.js"
import { killDevProcessTree } from "./process-tree.js"
import {
  getComponentPreviewAllowedHosts,
  getComponentPreviewBasePath,
  getComponentPreviewInternalUrl,
  getComponentPreviewPublicUrl,
  resolveComponentPreviewDir,
} from "./paths.js"

const execFileAsync = promisify(execFile)

type DevStatus = "stopped" | "starting" | "running" | "failed"

let devProcess: ChildProcess | null = null
let devStatus: DevStatus = "stopped"
let devError: string | null = null
let activeEnv: Env | null = null
let restartInFlight: Promise<{ status: DevStatus; url: string | null; error: string | null }> | null =
  null

function getInternalProbeUrl(env: Env) {
  return getComponentPreviewInternalUrl(
    env.COMPONENT_PREVIEW_DEV_HOST,
    env.COMPONENT_PREVIEW_DEV_PORT,
    env.COMPONENT_PREVIEW_PUBLIC_URL,
  )
}

function getPublicBaseUrl(env: Env) {
  return getComponentPreviewPublicUrl(
    env.COMPONENT_PREVIEW_DEV_HOST,
    env.COMPONENT_PREVIEW_DEV_PORT,
    env.COMPONENT_PREVIEW_PUBLIC_URL,
  )
}

async function ensureNpmInstall(previewDir: string) {
  try {
    await fs.access(path.join(previewDir, "node_modules"))
  } catch {
    await execFileAsync("npm", ["install"], {
      cwd: previewDir,
      shell: true,
      windowsHide: true,
    })
  }
}

async function isPreviewServerRunning(url: string) {
  try {
    const response = await fetch(url, { method: "GET" })
    return response.ok || response.status === 404
  } catch {
    return false
  }
}

async function clearStaleAstroDevLock(previewDir: string, url: string) {
  if (await isPreviewServerRunning(url)) {
    return
  }

  const devJsonPath = path.join(previewDir, ".astro", "dev.json")

  try {
    await fs.access(devJsonPath)
  } catch {
    return
  }

  try {
    await execFileAsync("npx", ["astro", "dev", "stop"], {
      cwd: previewDir,
      shell: true,
      windowsHide: true,
    })
  } catch {
    try {
      await fs.unlink(devJsonPath)
    } catch {
      // ignore
    }
  }
}

async function waitForDevServer(url: string, timeoutMs = 90_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPreviewServerRunning(url)) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error("Component preview dev server failed to start in time")
}

export function getComponentDevServerStatus() {
  return {
    status: devStatus,
    url: activeEnv ? getPublicBaseUrl(activeEnv) : null,
    error: devError,
  }
}

export async function stopComponentDevServer() {
  if (devProcess) {
    await killDevProcessTree(devProcess)
    devProcess = null
  }

  if (activeEnv) {
    const previewDir = resolveComponentPreviewDir(activeEnv.COMPONENT_PREVIEW_DIR)

    try {
      await execFileAsync("npx", ["astro", "dev", "stop"], {
        cwd: previewDir,
        shell: true,
        windowsHide: true,
      })
    } catch {
      // ignore
    }
  }

  devStatus = "stopped"
  devError = null

  return getComponentDevServerStatus()
}

export async function ensureComponentDevServer(env: Env, db: Db) {
  activeEnv = env
  const internalUrl = getInternalProbeUrl(env)
  const publicUrl = getPublicBaseUrl(env)
  const port = env.COMPONENT_PREVIEW_DEV_PORT
  const basePath = getComponentPreviewBasePath(env.COMPONENT_PREVIEW_PUBLIC_URL)
  const publicUrlForAstro = env.COMPONENT_PREVIEW_PUBLIC_URL?.trim().replace(/\/$/, "") || ""
  const allowedHostsConfig = getComponentPreviewAllowedHosts(
    env.COMPONENT_PREVIEW_PUBLIC_URL,
    env.COMPONENT_PREVIEW_ALLOWED_HOSTS,
  )
  const allowedHostsEnvValue =
    allowedHostsConfig === true ? "true" : allowedHostsConfig.join(",")

  if (devStatus === "running" && devProcess) {
    return { ...getComponentDevServerStatus(), url: publicUrl }
  }

  if (await isPreviewServerRunning(internalUrl)) {
    devStatus = "running"
    devError = null
    return { ...getComponentDevServerStatus(), url: publicUrl }
  }

  if (devStatus === "starting") {
    await waitForDevServer(internalUrl)
    devStatus = "running"
    return { ...getComponentDevServerStatus(), url: publicUrl }
  }

  await ensureComponentPreviewWorkspace(db, env)
  const previewDir = resolveComponentPreviewDir(env.COMPONENT_PREVIEW_DIR)
  await ensureNpmInstall(previewDir)
  await clearStaleAstroDevLock(previewDir, internalUrl)

  devStatus = "starting"
  devError = null

  const devArgs = ["run", "dev", "--", "--port", String(port), "--host"]
  if (basePath !== "/") {
    devArgs.push("--base", basePath)
  }
  // Astro CLI / Vite 6: config alone is flaky behind reverse proxies
  if (allowedHostsConfig === true) {
    devArgs.push("--allowed-hosts", "true")
  } else if (allowedHostsConfig.length > 0) {
    devArgs.push("--allowed-hosts", allowedHostsConfig.join(","))
  }

  devProcess = spawn("npm", devArgs, {
    cwd: previewDir,
    shell: true,
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      COMPONENT_PREVIEW_BASE: basePath,
      ...(publicUrlForAstro ? { COMPONENT_PREVIEW_PUBLIC_URL: publicUrlForAstro } : {}),
      ...(allowedHostsEnvValue
        ? {
            COMPONENT_PREVIEW_ALLOWED_HOSTS: allowedHostsEnvValue,
            // Vite-native escape hatch (works even when vite.server.allowedHosts in config is ignored)
            __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: allowedHostsEnvValue,
          }
        : {}),
    },
  })

  devProcess.on("exit", (code) => {
    if (devStatus !== "stopped") {
      devStatus = "failed"
      devError = `Dev server exited with code ${code ?? "unknown"}`
    }
    devProcess = null
  })

  devProcess.stderr?.on("data", (chunk: Buffer) => {
    const message = chunk.toString()
    if (message.toLowerCase().includes("error")) {
      devError = message.trim()
    }
  })

  try {
    await waitForDevServer(internalUrl)
    devStatus = "running"
    devError = null
  } catch (error) {
    devStatus = "failed"
    devError = error instanceof Error ? error.message : "Failed to start dev server"
    if (devProcess) {
      await killDevProcessTree(devProcess)
    }
    devProcess = null
    throw error
  }

  return { ...getComponentDevServerStatus(), url: publicUrl }
}

async function restartComponentDevServer(env: Env, db: Db) {
  activeEnv = env
  const internalUrl = getInternalProbeUrl(env)

  if (!(await isPreviewServerRunning(internalUrl)) && devStatus !== "running" && !devProcess) {
    return ensureComponentDevServer(env, db)
  }

  await stopComponentDevServer()
  await new Promise((resolve) => setTimeout(resolve, 800))
  return ensureComponentDevServer(env, db)
}

export async function restartComponentDevServerIfRunning(env: Env, db: Db) {
  if (restartInFlight) {
    return restartInFlight
  }

  restartInFlight = restartComponentDevServer(env, db).finally(() => {
    restartInFlight = null
  })

  return restartInFlight
}

export function buildComponentPreviewUrl(
  env: Env,
  componentSlug: string,
  variantSlug: string,
) {
  const baseUrl = getPublicBaseUrl(env)
  return `${baseUrl}/preview/${encodeURIComponent(componentSlug)}/${encodeURIComponent(variantSlug)}`
}
