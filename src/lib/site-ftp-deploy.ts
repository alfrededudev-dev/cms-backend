import fs from "node:fs/promises"
import path from "node:path"
import { appendSiteDevLog } from "./site-dev-server.js"
import { buildSiteWorkspace } from "./site-workspace-build.js"
import { type FtpConnectionConfig, withFtpClient } from "./site-ftp-config.js"

export type { FtpConnectionConfig } from "./site-ftp-config.js"
export { resolveSiteFtpConfig } from "./site-ftp-config.js"

export async function verifySiteFtpConnection(config: FtpConnectionConfig) {
  return withFtpClient(config, async (client) => {
    await client.ensureDir(config.remotePath)
    await client.cd(config.remotePath)
    const listing = await client.list(".")

    return {
      ok: true as const,
      remotePath: config.remotePath,
      entryCount: listing.length,
    }
  })
}

async function countLocalFiles(dirPath: string): Promise<number> {
  let count = 0
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      count += await countLocalFiles(entryPath)
    } else if (entry.isFile()) {
      count += 1
    }
  }

  return count
}

export async function deploySiteDistViaFtp(input: {
  siteId: number
  workspacePath: string
  config: FtpConnectionConfig
  buildIfMissing?: boolean
}) {
  const distPath = path.join(input.workspacePath, "dist")
  let built = false

  const distExists = await fs.access(distPath).then(() => true).catch(() => false)

  if (!distExists) {
    if (!input.buildIfMissing) {
      throw new Error("Build output (dist/) is missing. Run Build first.")
    }

    appendSiteDevLog(input.siteId, "system", "dist/ not found — running production build before deploy")
    await buildSiteWorkspace(input.siteId, input.workspacePath)
    built = true
  }

  const fileCount = await countLocalFiles(distPath)

  if (fileCount === 0) {
    throw new Error("dist/ is empty. Add content and build before deploying.")
  }

  appendSiteDevLog(
    input.siteId,
    "system",
    `Uploading ${fileCount} file(s) from dist/ to ftp://${input.config.host}${input.config.remotePath}`,
  )

  await withFtpClient(input.config, async (client) => {
    await client.ensureDir(input.config.remotePath)
    await client.cd(input.config.remotePath)
    await client.clearWorkingDir()
    await client.uploadFromDir(distPath)
  })

  appendSiteDevLog(input.siteId, "system", `FTP deploy completed (${fileCount} file(s) uploaded)`)

  return {
    success: true as const,
    built,
    fileCount,
    remotePath: input.config.remotePath,
    host: input.config.host,
  }
}
