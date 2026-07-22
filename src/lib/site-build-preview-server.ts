import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import type { Env } from "../env.js"
import { appendSiteDevLog } from "./site-dev-server.js"
import { plainTerminalEnv } from "./terminal-sanitize.js"

type BuildPreviewEntry = {
  process: ChildProcess
  port: number
}

const buildPreviewServers = new Map<number, BuildPreviewEntry>()

export function getSiteBuildPreviewPort(env: Env, siteId: number) {
  return env.SITE_DEV_PORT_BASE + siteId + 500
}

export function getSiteBuildPreviewUrl(env: Env, siteId: number) {
  return `http://${env.SITE_DEV_HOST}:${getSiteBuildPreviewPort(env, siteId)}`
}

async function waitForPreviewServer(siteId: number, url: string, timeoutMs = 60_000) {
  appendSiteDevLog(siteId, "system", `Waiting for build preview at ${url}...`)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" })
      if (response.ok || response.status === 404) {
        appendSiteDevLog(siteId, "system", "Build preview server is responding")
        return
      }
    } catch {
      // not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error("Build preview server failed to start in time")
}

function killProcessTree(processRef: ChildProcess): Promise<void> {
  if (!processRef.pid) {
    processRef.kill()
    return Promise.resolve()
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(processRef.pid), "/T", "/F"], {
        shell: true,
        windowsHide: true,
        stdio: "ignore",
      })

      killer.on("close", () => resolve())
      killer.on("error", () => resolve())
    })
  }

  processRef.kill("SIGTERM")

  return new Promise((resolve) => {
    processRef.once("close", () => resolve())
    setTimeout(resolve, 2000)
  })
}

export async function stopSiteBuildPreview(siteId: number) {
  const entry = buildPreviewServers.get(siteId)
  if (!entry) {
    return
  }

  appendSiteDevLog(siteId, "system", "Stopping build preview server...")
  buildPreviewServers.delete(siteId)
  await killProcessTree(entry.process)
  appendSiteDevLog(siteId, "system", "Build preview server stopped")
}

export async function ensureSiteBuildPreview(env: Env, siteId: number, workspacePath: string) {
  const absoluteWorkspacePath = path.resolve(workspacePath)
  const distDir = path.join(absoluteWorkspacePath, "dist")

  try {
    await fs.access(path.join(distDir, "index.html"))
  } catch {
    throw new Error("Build output not found. Run Build first.")
  }

  const url = getSiteBuildPreviewUrl(env, siteId)
  const port = getSiteBuildPreviewPort(env, siteId)
  const existing = buildPreviewServers.get(siteId)

  if (existing) {
    appendSiteDevLog(siteId, "system", `Build preview already running at ${url}`)
    return { url, port }
  }

  appendSiteDevLog(siteId, "system", `Starting build preview for site #${siteId}`)
  appendSiteDevLog(siteId, "system", `$ npm run preview -- --port ${port} --host`)

  const previewProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--host"], {
    cwd: absoluteWorkspacePath,
    shell: true,
    env: {
      ...process.env,
      ...plainTerminalEnv,
    },
    windowsHide: true,
    stdio: "pipe",
  })

  buildPreviewServers.set(siteId, { process: previewProcess, port })

  previewProcess.stdout?.on("data", (chunk: Buffer) => {
    appendSiteDevLog(siteId, "stdout", chunk.toString())
  })

  previewProcess.stderr?.on("data", (chunk: Buffer) => {
    appendSiteDevLog(siteId, "stderr", chunk.toString())
  })

  previewProcess.on("exit", (code) => {
    if (buildPreviewServers.has(siteId)) {
      appendSiteDevLog(siteId, "system", `Build preview exited with code ${code ?? "unknown"}`)
      buildPreviewServers.delete(siteId)
    }
  })

  await waitForPreviewServer(siteId, url)
  appendSiteDevLog(siteId, "system", `Build preview ready at ${url}`)

  return { url, port }
}

export async function purgeSiteBuildPreview(siteId: number) {
  await stopSiteBuildPreview(siteId)
}
