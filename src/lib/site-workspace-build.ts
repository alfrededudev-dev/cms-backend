import fs from "node:fs/promises"
import path from "node:path"
import { appendSiteDevLog, ensureNpmInstall } from "./site-dev-server.js"
import { runWorkspaceNpmScript } from "./site-workspace-npm.js"

const activeBuilds = new Set<number>()

export async function buildSiteWorkspace(siteId: number, workspacePath: string) {
  if (activeBuilds.has(siteId)) {
    throw new Error("Build is already in progress")
  }

  const absoluteWorkspacePath = path.resolve(workspacePath)

  try {
    await fs.access(path.join(absoluteWorkspacePath, "package.json"))
  } catch {
    throw new Error(`Site workspace is missing package.json (${absoluteWorkspacePath})`)
  }

  activeBuilds.add(siteId)

  try {
    appendSiteDevLog(siteId, "system", `Starting production build for site #${siteId}`)
    appendSiteDevLog(siteId, "system", `Workspace: ${absoluteWorkspacePath}`)

    await ensureNpmInstall(siteId, absoluteWorkspacePath)

    appendSiteDevLog(siteId, "system", `$ npm run build`)

    const { stdout, stderr } = await runWorkspaceNpmScript(absoluteWorkspacePath, "build")

    if (stdout.trim()) {
      appendSiteDevLog(siteId, "stdout", stdout)
    }

    if (stderr.trim()) {
      appendSiteDevLog(siteId, "stderr", stderr)
    }

    const outputDir = path.join(absoluteWorkspacePath, "dist")
    const hasOutput = await fs.access(outputDir).then(() => true).catch(() => false)

    appendSiteDevLog(
      siteId,
      "system",
      hasOutput ? `Build completed successfully (${outputDir})` : "Build completed successfully",
    )

    return {
      success: true as const,
      workspacePath: absoluteWorkspacePath,
      outputDir: hasOutput ? outputDir : null,
    }
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const stdout = execError.stdout?.toString().trim() ?? ""
    const stderr = execError.stderr?.toString().trim() ?? ""

    if (stdout) {
      appendSiteDevLog(siteId, "stdout", stdout)
    }

    if (stderr) {
      appendSiteDevLog(siteId, "stderr", stderr)
    }

    const message = stderr || stdout || (error instanceof Error ? error.message : "Build failed")
    appendSiteDevLog(siteId, "stderr", message)
    throw new Error(message)
  } finally {
    activeBuilds.delete(siteId)
  }
}

export function isSiteBuildInProgress(siteId: number) {
  return activeBuilds.has(siteId)
}
