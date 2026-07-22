import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { createSite, deleteSite, getSiteById, listSites, mapSiteResponse, updateSite, updateSiteFtpConfig, updateSiteGitConfig } from "../db/sites.js"
import { cloneSite } from "../db/site-clone.js"
import type { Db } from "../db/index.js"
import { getSiteTemplate, saveSiteTemplate } from "../db/site-template.js"
import { getSiteLayout, saveSiteLayout, listSiteLayouts, createSiteLayout, getSiteLayoutById, saveSiteLayoutById, deleteSiteLayout } from "../db/site-layout.js"
import { ensureSiteCustomCodeInWorkspace, getSiteCustomCode, saveSiteCustomCode } from "../db/site-custom-code.js"
import { ensureSiteThemeInWorkspace, getSiteTheme, saveSiteTheme } from "../db/site-theme.js"
import {
  createCollectionEntry,
  createSiteCollection,
  deleteCollectionEntry,
  deleteSiteCollection,
  linkCollectionTemplatePage,
  getSiteCollection,
  listSiteCollections,
  listSiteContentTypes,
  updateCollectionEntry,
  updateSingleTypeData,
  updateSiteCollection,
  updateSiteCollectionModel,
} from "../db/site-collections.js"
import {
  createSiteForm,
  deleteApplication,
  deleteSiteForm,
  getSiteForm,
  listSiteApplications,
  listSiteForms,
  updateApplicationStatus,
  updateSiteForm,
} from "../db/site-forms.js"
import { getSiteSmtpSettings, testSiteSmtpSettings, updateSiteSmtpSettings } from "../db/site-smtp-settings.js"
import { ensureSiteDevServer, getSiteDevServerSnapshot, getSiteDevServerStatus, stopSiteDevServer } from "../lib/site-dev-server.js"
import { syncSharedComponentsToSite } from "../lib/site-component-sync.js"
import { buildSiteWorkspace } from "../lib/site-workspace-build.js"
import { ensureSiteBuildPreview, stopSiteBuildPreview } from "../lib/site-build-preview-server.js"
import { resolveSiteWorkspacePath } from "../lib/paths.js"
import { saveMediaUpload } from "../lib/media-upload.js"
import {
  createSiteWorkspaceFile,
  deleteSiteWorkspaceFile,
  listSiteWorkspaceFiles,
  readSiteWorkspaceFile,
  writeSiteWorkspaceFile,
} from "../lib/site-workspace-files.js"
import {
  commitSiteWorkspaceGit,
  connectSiteWorkspaceToGitHub,
  getSiteWorkspaceGitStatus,
  initSiteWorkspaceGit,
  pushSiteWorkspaceGit,
} from "../lib/site-workspace-git.js"
import { verifyGitHubToken } from "../lib/github-api.js"
import { deploySiteDistViaFtp, resolveSiteFtpConfig, verifySiteFtpConnection } from "../lib/site-ftp-deploy.js"
import { checkSiteDomainHealth } from "../lib/site-health-check.js"
import { checkSiteFormsHealth } from "../lib/site-forms-check.js"
import { normalizeFtpHost } from "../lib/site-ftp-config.js"
import type { AppBindings } from "../middleware/auth.js"
import { authMiddleware } from "../middleware/auth.js"
import type { Env } from "../env.js"
import { dataFieldDefinitionSchema } from "../lib/data-model.js"

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  )
}

function getRouteErrorMessage(error: unknown, fallback: string) {
  if (isUniqueViolation(error)) {
    return "Content type with this slug already exists"
  }

  if (error instanceof Error && error.cause) {
    if (isUniqueViolation(error.cause)) {
      return "Content type with this slug already exists"
    }

    if (error.cause instanceof Error && error.cause.message) {
      return error.cause.message
    }
  }

  return error instanceof Error ? error.message : fallback
}

const createSiteSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  description: z.string().optional(),
})

const cloneSiteSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
})

const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["published", "draft", "archived"]).optional(),
})

const templateBlockSchema = z.object({
  componentId: z.number().int().positive(),
  variantSlug: z.string().min(1),
  props: z.record(z.unknown()).optional(),
  themeColorMap: z.record(z.string()).optional(),
  collectionEntryLoop: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const dataFieldDefinitionSchemaForRoutes = dataFieldDefinitionSchema

const templatePageSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  pageType: z.enum(["static", "collection"]).default("static"),
  layoutId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().optional(),
  blocks: z.array(templateBlockSchema),
})

const saveTemplateSchema = z.object({
  pages: z.array(templatePageSchema).min(1),
})

const layoutBlockSchema = z.object({
  componentId: z.number().int().positive(),
  variantSlug: z.string().min(1),
  props: z.record(z.unknown()).optional(),
  themeColorMap: z.record(z.string()).optional(),
  sortOrder: z.number().int().optional(),
})

const saveLayoutSchema = z.object({
  blocks: z.array(layoutBlockSchema),
})

const createLayoutSchema = z.object({
  name: z.string().min(1),
})

const createCollectionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  kind: z.enum(["collection", "single", "global"]).optional(),
  fieldsSchema: z.array(dataFieldDefinitionSchemaForRoutes).optional(),
  createTemplatePage: z.boolean().optional(),
})

const updateCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  fieldsSchema: z.array(dataFieldDefinitionSchemaForRoutes).optional(),
})

const updateSingleTypeSchema = z.object({
  data: z.record(z.unknown()),
})

const createEntrySchema = z.object({
  data: z.record(z.unknown()),
  slug: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  publishedAt: z.string().nullable().optional(),
})

const updateEntrySchema = z.object({
  data: z.record(z.unknown()).optional(),
  slug: z.string().optional(),
  status: z.enum(["draft", "published"]).optional(),
  publishedAt: z.string().nullable().optional(),
})

const createFormSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
})

const updateFormSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  fieldsSchema: z.array(dataFieldDefinitionSchemaForRoutes).optional(),
  settings: z
    .object({
      successMessage: z.string().optional(),
      redirectUrl: z.string().optional(),
      notifyEmail: z.string().optional(),
      honeypotField: z.string().optional(),
      disabledFieldKeys: z.array(z.string()).optional(),
    })
    .optional(),
})

const updateApplicationSchema = z.object({
  status: z.enum(["new", "in_progress", "completed", "spam"]),
})

const smtpConfigSchema = z.object({
  host: z.string().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: z.string().optional(),
  password: z.string().nullable().optional(),
  from: z.string().optional(),
  secure: z.boolean().optional(),
})

const writeWorkspaceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const createWorkspaceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
})

const createGitHubRepoSchema = z.object({
  token: z.string().trim().min(1),
  name: z.string().trim().min(1),
  private: z.boolean().optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
})

const verifyGitHubTokenSchema = z.object({
  token: z.string().trim().min(1),
  private: z.boolean().optional(),
})

const commitGitSchema = z.object({
  message: z.string().min(1),
})

const pushGitSchema = z.object({
  token: z.string().trim().min(1),
  branch: z.string().optional(),
})

const ftpConfigSchema = z.object({
  host: z.string().trim().min(1).optional(),
  port: z.coerce.number().int().positive().optional(),
  username: z.string().trim().min(1).optional(),
  password: z.string().optional(),
  remotePath: z.string().optional(),
  secure: z.boolean().optional(),
})

const saveFtpConfigSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().positive().default(21),
  username: z.string().trim().min(1),
  password: z.string().optional(),
  remotePath: z.string().optional(),
  secure: z.boolean().optional().default(false),
})

const checkSiteHealthSchema = z.object({
  domain: z.string().trim().min(1).optional(),
})

const deployFtpSchema = z.object({
  buildIfMissing: z.boolean().optional().default(true),
})

const saveCustomCodeSchema = z.object({
  headStyles: z.string(),
  headLinks: z.string(),
  headScripts: z.string(),
  bodyScripts: z.string(),
})

const themeColorSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
})

const saveThemeSchema = z.object({
  colors: z.array(themeColorSchema),
})

async function getReadySiteWorkspace(db: Db, env: Env, siteId: number) {
  const site = await getSiteById(db, siteId)

  if (!site) {
    throw new HTTPException(404, { message: "Site not found" })
  }

  if (site.cloneStatus !== "ready") {
    throw new HTTPException(400, { message: "Site workspace is not ready" })
  }

  const workspacePath = resolveSiteWorkspacePath(env.WORKSPACES_DIR, siteId, site.workspacePath)

  try {
    await fs.access(path.join(workspacePath, "package.json"))
  } catch {
    throw new HTTPException(400, { message: "Site workspace is not ready" })
  }

  return {
    ...site,
    workspacePath,
  }
}

export const sitesRoutes = new Hono<AppBindings>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const items = await listSites(c.get("db"))
    return c.json({ sites: items.map(mapSiteResponse) })
  })
  .get("/:id/template", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    const template = await getSiteTemplate(c.get("db"), c.get("env"), siteId)
    return c.json({ template })
  })
  .put("/:id/template", zValidator("json", saveTemplateSchema), async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    try {
      const template = await saveSiteTemplate(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ template })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save site template",
      })
    }
  })
  .get("/:id/layout", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    const layout = await getSiteLayout(c.get("db"), c.get("env"), siteId)
    return c.json({ layout })
  })
  .put("/:id/layout", zValidator("json", saveLayoutSchema), async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    try {
      const layout = await saveSiteLayout(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ layout })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save site layout",
      })
    }
  })
  .get("/:id/layouts", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    const layouts = await listSiteLayouts(c.get("db"), siteId)
    return c.json({ layouts })
  })
  .post("/:id/layouts", zValidator("json", createLayoutSchema), async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    try {
      const layout = await createSiteLayout(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ layout })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to create layout",
      })
    }
  })
  .get("/:id/layouts/:layoutId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const layoutId = Number(c.req.param("layoutId"))

    if (Number.isNaN(siteId) || Number.isNaN(layoutId)) {
      throw new HTTPException(400, { message: "Invalid site or layout id" })
    }

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    try {
      const layout = await getSiteLayoutById(c.get("db"), c.get("env"), siteId, layoutId)
      return c.json({ layout })
    } catch (error) {
      throw new HTTPException(404, {
        message: error instanceof Error ? error.message : "Layout not found",
      })
    }
  })
  .put("/:id/layouts/:layoutId", zValidator("json", saveLayoutSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const layoutId = Number(c.req.param("layoutId"))

    if (Number.isNaN(siteId) || Number.isNaN(layoutId)) {
      throw new HTTPException(400, { message: "Invalid site or layout id" })
    }

    try {
      const layout = await saveSiteLayoutById(
        c.get("db"),
        c.get("env"),
        siteId,
        layoutId,
        c.req.valid("json"),
      )
      return c.json({ layout })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save site layout",
      })
    }
  })
  .delete("/:id/layouts/:layoutId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const layoutId = Number(c.req.param("layoutId"))

    if (Number.isNaN(siteId) || Number.isNaN(layoutId)) {
      throw new HTTPException(400, { message: "Invalid site or layout id" })
    }

    try {
      const layouts = await deleteSiteLayout(c.get("db"), c.get("env"), siteId, layoutId)
      return c.json({ layouts })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to delete layout",
      })
    }
  })
  .get("/:id/theme", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const theme = await getSiteTheme(c.get("db"), siteId)
    return c.json({ theme })
  })
  .put("/:id/theme", zValidator("json", saveThemeSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const theme = await saveSiteTheme(c.get("db"), c.get("env"), siteId, c.req.valid("json").colors)
      return c.json({ theme })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save site theme",
      })
    }
  })
  .get("/:id/custom-code", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const customCode = await getSiteCustomCode(c.get("db"), siteId)
    return c.json({ customCode })
  })
  .put("/:id/custom-code", zValidator("json", saveCustomCodeSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const customCode = await saveSiteCustomCode(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ customCode })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save custom code",
      })
    }
  })
  .get("/:id/smtp", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const smtp = await getSiteSmtpSettings(c.get("db"), siteId)
    return c.json({ smtp })
  })
  .put("/:id/smtp", zValidator("json", smtpConfigSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const smtp = await updateSiteSmtpSettings(c.get("db"), siteId, c.req.valid("json"))
      return c.json({ smtp })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save SMTP settings",
      })
    }
  })
  .post("/:id/smtp/test", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const result = await testSiteSmtpSettings(c.get("db"), c.get("env"), siteId)
      return c.json(result)
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "SMTP test failed",
      })
    }
  })
  .get("/:id/dev/status", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    return c.json(getSiteDevServerStatus(c.get("env"), siteId))
  })
  .get("/:id/dev/logs", async (c) => {
    const siteId = Number(c.req.param("id"))
    const since = c.req.query("since")

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    return c.json(getSiteDevServerSnapshot(c.get("env"), siteId, since))
  })
  .post("/:id/dev/start", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    if (site.cloneStatus !== "ready") {
      throw new HTTPException(400, { message: "Site workspace is not ready" })
    }

    const workspacePath = resolveSiteWorkspacePath(c.get("env").WORKSPACES_DIR, siteId, site.workspacePath)

    try {
      await ensureSiteThemeInWorkspace(c.get("db"), c.get("env"), siteId)
      await ensureSiteCustomCodeInWorkspace(c.get("db"), c.get("env"), siteId)
      await syncSharedComponentsToSite(c.get("env"), siteId)
      const result = await ensureSiteDevServer(c.get("env"), siteId, workspacePath)
      return c.json(result)
    } catch (error) {
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Failed to start site dev server",
      })
    }
  })
  .post("/:id/dev/stop", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const result = await stopSiteDevServer(siteId)
    return c.json(result)
  })
  .post("/:id/build", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    try {
      const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
      const build = await buildSiteWorkspace(siteId, site.workspacePath)

      return c.json({ build })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to build site",
      })
    }
  })
  .post("/:id/build/preview/start", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      const preview = await ensureSiteBuildPreview(c.get("env"), siteId, site.workspacePath)
      return c.json(preview)
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to start build preview",
      })
    }
  })
  .post("/:id/build/preview/stop", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    await stopSiteBuildPreview(siteId)
    return c.json({ success: true })
  })
  .post("/:id/media", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    if (site.cloneStatus !== "ready" || !site.workspacePath) {
      throw new HTTPException(400, { message: "Site workspace is not ready" })
    }

    const body = await c.req.parseBody()
    const file = body.file

    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: "Image file is required" })
    }

    const workspacePath = resolveSiteWorkspacePath(c.get("env").WORKSPACES_DIR, siteId, site.workspacePath)
    const mediaDir = path.join(workspacePath, "public", "media")
    const saved = await saveMediaUpload(mediaDir, file)

    return c.json(saved)
  })
  .get("/:id/media/:filename", async (c) => {
    const siteId = Number(c.req.param("id"))
    const filename = path.basename(c.req.param("filename") ?? "")

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    if (!filename || filename === "." || filename === "..") {
      throw new HTTPException(400, { message: "Invalid media filename" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    if (site.cloneStatus !== "ready" || !site.workspacePath) {
      throw new HTTPException(400, { message: "Site workspace is not ready" })
    }

    const workspacePath = resolveSiteWorkspacePath(c.get("env").WORKSPACES_DIR, siteId, site.workspacePath)
    const filePath = path.join(workspacePath, "public", "media", filename)

    try {
      const content = await fs.readFile(filePath)
      const ext = path.extname(filename).toLowerCase()
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".avif": "image/avif",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".heic": "image/heic",
        ".heif": "image/heif",
      }

      return new Response(content, {
        headers: {
          "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
        },
      })
    } catch {
      throw new HTTPException(404, { message: "Media file not found" })
    }
  })
  .get("/:id/workspace/files", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      return c.json(await listSiteWorkspaceFiles(site.workspacePath!))
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to list files" })
    }
  })
  .get("/:id/workspace/file", async (c) => {
    const siteId = Number(c.req.param("id"))
    const filePath = c.req.query("path")

    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })
    if (!filePath) throw new HTTPException(400, { message: "File path is required" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      const file = await readSiteWorkspaceFile(site.workspacePath!, filePath)
      return c.json({ file })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to read file" })
    }
  })
  .put("/:id/workspace/file", zValidator("json", writeWorkspaceFileSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const file = await writeSiteWorkspaceFile(site.workspacePath!, body.path, body.content)
      return c.json({ file })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to save file" })
    }
  })
  .post("/:id/workspace/file", zValidator("json", createWorkspaceFileSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const file = await createSiteWorkspaceFile(site.workspacePath!, body.path, body.content ?? "")
      return c.json({ file }, 201)
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to create file" })
    }
  })
  .delete("/:id/workspace/file", async (c) => {
    const siteId = Number(c.req.param("id"))
    const filePath = c.req.query("path")

    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })
    if (!filePath) throw new HTTPException(400, { message: "File path is required" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      const result = await deleteSiteWorkspaceFile(site.workspacePath!, filePath)
      return c.json(result)
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to delete file" })
    }
  })
  .get("/:id/workspace/git/status", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      const status = await getSiteWorkspaceGitStatus(site.workspacePath!)
      return c.json({
        status,
        gitRemoteUrl: site.gitRemoteUrl ?? status.remoteUrl,
        gitBranch: site.gitBranch ?? "main",
      })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to read git status" })
    }
  })
  .post("/:id/workspace/git/init", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)

    try {
      const status = await initSiteWorkspaceGit(site.workspacePath!)
      const updatedSite = await updateSiteGitConfig(c.get("db"), siteId, { gitBranch: "main" })
      return c.json({
        status,
        site: mapSiteResponse(updatedSite),
      })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to initialize git" })
    }
  })
  .post("/:id/workspace/git/github/verify", zValidator("json", verifyGitHubTokenSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const verification = await verifyGitHubToken(body.token, { privateRepo: body.private })
      return c.json({ verification })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to verify GitHub token",
      })
    }
  })
  .post("/:id/workspace/git/github/repo", zValidator("json", createGitHubRepoSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const result = await connectSiteWorkspaceToGitHub({
        workspacePath: site.workspacePath!,
        token: body.token,
        repoName: body.name,
        private: body.private,
        description: body.description,
        owner: body.owner,
      })

      const updatedSite = await updateSiteGitConfig(c.get("db"), siteId, {
        gitRemoteUrl: result.remoteUrl,
        gitBranch: result.branch,
      })

      return c.json({
        repository: {
          htmlUrl: result.htmlUrl,
          fullName: result.fullName,
          remoteUrl: result.remoteUrl,
          branch: result.branch,
        },
        status: result.status,
        site: mapSiteResponse(updatedSite),
      })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to create GitHub repository",
      })
    }
  })
  .post("/:id/workspace/git/commit", zValidator("json", commitGitSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const status = await commitSiteWorkspaceGit(site.workspacePath!, body.message)
      return c.json({ status })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to create commit" })
    }
  })
  .post("/:id/workspace/git/push", zValidator("json", pushGitSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const status = await pushSiteWorkspaceGit({
        workspacePath: site.workspacePath!,
        token: body.token,
        branch: body.branch ?? site.gitBranch ?? "main",
        remoteUrl: site.gitRemoteUrl,
      })

      return c.json({ status })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to push" })
    }
  })
  .get("/:id/deploy/config", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    return c.json({
      ftp: {
        host: normalizeFtpHost(site.ftpHost ?? "").host,
        port: site.ftpPort ?? 21,
        username: site.ftpUsername ?? "",
        remotePath: site.ftpRemotePath ?? "",
        secure: site.ftpSecure ?? false,
        hasPassword: Boolean(site.ftpPassword),
      },
    })
  })
  .put("/:id/deploy/ftp", zValidator("json", saveFtpConfigSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const body = c.req.valid("json")
    const existing = await getSiteById(c.get("db"), siteId)
    if (!existing) throw new HTTPException(404, { message: "Site not found" })

    if (!body.password?.trim() && !existing.ftpPassword) {
      throw new HTTPException(400, { message: "FTP password is required" })
    }

    try {
      const normalizedHost = normalizeFtpHost(body.host)

      if (!normalizedHost.host) {
        throw new HTTPException(400, { message: "Enter a valid FTP host (IP or domain, without ftp://)" })
      }

      const site = await updateSiteFtpConfig(c.get("db"), siteId, {
        ftpHost: normalizedHost.host,
        ftpPort: body.port ?? normalizedHost.port ?? 21,
        ftpUsername: body.username,
        ...(body.password?.trim() ? { ftpPassword: body.password.trim() } : {}),
        ftpRemotePath: body.remotePath?.trim() || normalizedHost.remotePath || "/",
        ftpSecure: body.secure ?? false,
      })

      return c.json({ site: mapSiteResponse(site) })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save FTP settings",
      })
    }
  })
  .post("/:id/deploy/ftp/verify", zValidator("json", ftpConfigSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const body = c.req.valid("json")

    try {
      const config = resolveSiteFtpConfig(site, {
        host: body.host,
        port: body.port,
        username: body.username,
        password: body.password,
        remotePath: body.remotePath,
        secure: body.secure,
      })

      const result = await verifySiteFtpConnection(config)
      return c.json({ verification: result })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "FTP connection failed",
      })
    }
  })
  .post("/:id/deploy/ftp", zValidator("json", deployFtpSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getReadySiteWorkspace(c.get("db"), c.get("env"), siteId)
    const body = c.req.valid("json")

    try {
      const config = resolveSiteFtpConfig(site)
      const deploy = await deploySiteDistViaFtp({
        siteId,
        workspacePath: site.workspacePath!,
        config,
        buildIfMissing: body.buildIfMissing,
      })

      return c.json({ deploy })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "FTP deploy failed",
      })
    }
  })
  .get("/:id/content-types", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    return c.json(await listSiteContentTypes(c.get("db"), siteId))
  })
  .get("/:id/collections", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    return c.json(await listSiteCollections(c.get("db"), siteId))
  })
  .post("/:id/collections", zValidator("json", createCollectionSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const collection = await createSiteCollection(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ collection }, 201)
    } catch (error) {
      throw new HTTPException(400, { message: getRouteErrorMessage(error, "Failed to create collection") })
    }
  })
  .post("/:id/collections/:collectionId/template-page", async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    try {
      const collection = await linkCollectionTemplatePage(c.get("db"), c.get("env"), siteId, collectionId)
      return c.json({ collection })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to create template page",
      })
    }
  })
  .get("/:id/collections/:collectionId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    const collection = await getSiteCollection(c.get("db"), siteId, collectionId)
    if (!collection) throw new HTTPException(404, { message: "Collection not found" })

    return c.json({ collection })
  })
  .patch("/:id/collections/:collectionId", zValidator("json", updateCollectionSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    try {
      const body = c.req.valid("json")
      const { fieldsSchema, ...metadata } = body

      if (fieldsSchema !== undefined) {
        await updateSiteCollectionModel(c.get("db"), c.get("env"), siteId, collectionId, fieldsSchema)
      }

      if (metadata.name !== undefined || metadata.description !== undefined) {
        await updateSiteCollection(c.get("db"), c.get("env"), siteId, collectionId, metadata)
      }

      const collection = await getSiteCollection(c.get("db"), siteId, collectionId)
      if (!collection) throw new HTTPException(404, { message: "Collection not found" })

      return c.json({ collection })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to update collection" })
    }
  })
  .delete("/:id/collections/:collectionId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    const deleted = await deleteSiteCollection(c.get("db"), c.get("env"), siteId, collectionId)
    if (!deleted) throw new HTTPException(404, { message: "Collection not found" })

    return c.json({ success: true })
  })
  .patch("/:id/collections/:collectionId/single", zValidator("json", updateSingleTypeSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    try {
      const collection = await updateSingleTypeData(
        c.get("db"),
        c.get("env"),
        siteId,
        collectionId,
        c.req.valid("json"),
      )
      return c.json({ collection })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to save single type content",
      })
    }
  })
  .post("/:id/collections/:collectionId/entries", zValidator("json", createEntrySchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId)) {
      throw new HTTPException(400, { message: "Invalid site or collection id" })
    }

    try {
      const collection = await createCollectionEntry(c.get("db"), c.get("env"), siteId, collectionId, c.req.valid("json"))
      return c.json({ collection }, 201)
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to create entry" })
    }
  })
  .patch("/:id/collections/:collectionId/entries/:entryId", zValidator("json", updateEntrySchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    const entryId = Number(c.req.param("entryId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId) || Number.isNaN(entryId)) {
      throw new HTTPException(400, { message: "Invalid id" })
    }

    try {
      const collection = await updateCollectionEntry(
        c.get("db"),
        c.get("env"),
        siteId,
        collectionId,
        entryId,
        c.req.valid("json"),
      )
      return c.json({ collection })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to update entry" })
    }
  })
  .delete("/:id/collections/:collectionId/entries/:entryId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const collectionId = Number(c.req.param("collectionId"))
    const entryId = Number(c.req.param("entryId"))
    if (Number.isNaN(siteId) || Number.isNaN(collectionId) || Number.isNaN(entryId)) {
      throw new HTTPException(400, { message: "Invalid id" })
    }

    const deleted = await deleteCollectionEntry(c.get("db"), c.get("env"), siteId, collectionId, entryId)
    if (!deleted) throw new HTTPException(404, { message: "Entry not found" })

    return c.json({ success: true })
  })
  .get("/:id/forms", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const forms = await listSiteForms(c.get("db"), siteId)
    return c.json({ forms })
  })
  .post("/:id/forms", zValidator("json", createFormSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    try {
      const form = await createSiteForm(c.get("db"), c.get("env"), siteId, c.req.valid("json"))
      return c.json({ form }, 201)
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to create form" })
    }
  })
  .get("/:id/forms/:formId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const formId = Number(c.req.param("formId"))
    if (Number.isNaN(siteId) || Number.isNaN(formId)) {
      throw new HTTPException(400, { message: "Invalid site or form id" })
    }

    const form = await getSiteForm(c.get("db"), siteId, formId)
    if (!form) throw new HTTPException(404, { message: "Form not found" })

    return c.json({ form })
  })
  .patch("/:id/forms/:formId", zValidator("json", updateFormSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const formId = Number(c.req.param("formId"))
    if (Number.isNaN(siteId) || Number.isNaN(formId)) {
      throw new HTTPException(400, { message: "Invalid site or form id" })
    }

    try {
      const form = await updateSiteForm(c.get("db"), c.get("env"), siteId, formId, c.req.valid("json"))
      if (!form) throw new HTTPException(404, { message: "Form not found" })
      return c.json({ form })
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to update form" })
    }
  })
  .delete("/:id/forms/:formId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const formId = Number(c.req.param("formId"))
    if (Number.isNaN(siteId) || Number.isNaN(formId)) {
      throw new HTTPException(400, { message: "Invalid site or form id" })
    }

    const deleted = await deleteSiteForm(c.get("db"), c.get("env"), siteId, formId)
    if (!deleted) throw new HTTPException(404, { message: "Form not found" })

    return c.json({ success: true })
  })
  .get("/:id/applications", async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) throw new HTTPException(404, { message: "Site not found" })

    const applications = await listSiteApplications(c.get("db"), siteId)
    return c.json({ applications })
  })
  .patch("/:id/applications/:applicationId", zValidator("json", updateApplicationSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    const applicationId = Number(c.req.param("applicationId"))
    if (Number.isNaN(siteId) || Number.isNaN(applicationId)) {
      throw new HTTPException(400, { message: "Invalid id" })
    }

    const application = await updateApplicationStatus(
      c.get("db"),
      applicationId,
      c.req.valid("json").status,
      siteId,
    )
    if (!application) throw new HTTPException(404, { message: "Application not found" })

    return c.json({ application })
  })
  .delete("/:id/applications/:applicationId", async (c) => {
    const siteId = Number(c.req.param("id"))
    const applicationId = Number(c.req.param("applicationId"))
    if (Number.isNaN(siteId) || Number.isNaN(applicationId)) {
      throw new HTTPException(400, { message: "Invalid id" })
    }

    const deleted = await deleteApplication(c.get("db"), applicationId, siteId)
    if (!deleted) throw new HTTPException(404, { message: "Application not found" })

    return c.json({ success: true })
  })
  .post("/:id/forms/check", zValidator("json", checkSiteHealthSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const existing = await getSiteById(c.get("db"), siteId)
    if (!existing) throw new HTTPException(404, { message: "Site not found" })

    const body = c.req.valid("json")
    const domain = body.domain?.trim() || existing.domain

    try {
      const check = await checkSiteFormsHealth(c.get("db"), c.get("env"), siteId, domain)
      const site = await updateSite(c.get("db"), siteId, { formsStatus: check.formsStatus })

      return c.json({
        check,
        site: mapSiteResponse(site),
      })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to check forms",
      })
    }
  })
  .post("/:id/health/check", zValidator("json", checkSiteHealthSchema), async (c) => {
    const siteId = Number(c.req.param("id"))
    if (Number.isNaN(siteId)) throw new HTTPException(400, { message: "Invalid site id" })

    const existing = await getSiteById(c.get("db"), siteId)
    if (!existing) throw new HTTPException(404, { message: "Site not found" })

    const body = c.req.valid("json")
    const domain = body.domain?.trim() || existing.domain

    try {
      const check = await checkSiteDomainHealth(domain)
      const site = await updateSite(c.get("db"), siteId, { siteHealth: check.siteHealth })

      return c.json({
        check,
        site: mapSiteResponse(site),
      })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to check site health",
      })
    }
  })
  .patch("/:id", zValidator("json", updateSiteSchema), async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    try {
      const site = await updateSite(c.get("db"), siteId, c.req.valid("json"))
      return c.json({ site: mapSiteResponse(site) })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "Site with this domain already exists" })
      }

      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Failed to update site" })
    }
  })
  .get("/:id", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)

    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    return c.json({ site: mapSiteResponse(site) })
  })
  .delete("/:id", async (c) => {
    const siteId = Number(c.req.param("id"))

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const deleted = await deleteSite(c.get("db"), c.get("env"), siteId)

    if (!deleted) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    return c.json({ success: true })
  })
  .post("/:id/clone", zValidator("json", cloneSiteSchema), async (c) => {
    const sourceSiteId = Number(c.req.param("id"))

    if (Number.isNaN(sourceSiteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const body = c.req.valid("json")

    try {
      const site = await cloneSite(c.get("db"), c.get("env"), sourceSiteId, body)
      const response = mapSiteResponse(site)

      if (site.cloneStatus === "failed") {
        return c.json(
          {
            site: response,
            sourceSiteId: String(sourceSiteId),
            message: site.cloneError ?? "Site record created but clone failed",
          },
          502,
        )
      }

      return c.json({ site: response, sourceSiteId: String(sourceSiteId) }, 201)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "Site with this domain already exists" })
      }

      if (error instanceof Error) {
        if (error.message === "Site not found") {
          throw new HTTPException(404, { message: error.message })
        }

        throw new HTTPException(400, { message: error.message })
      }

      throw error
    }
  })
  .post("/", zValidator("json", createSiteSchema), async (c) => {
    const body = c.req.valid("json")

    try {
      const site = await createSite(c.get("db"), c.get("env"), body)
      const response = mapSiteResponse(site)

      if (site.cloneStatus === "failed") {
        return c.json(
          {
            site: response,
            message: site.cloneError ?? "Failed to clone starter repository",
          },
          502,
        )
      }

      return c.json({ site: response }, 201)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "Site with this domain already exists" })
      }

      if (error instanceof Error) {
        throw new HTTPException(400, { message: error.message })
      }

      throw error
    }
  })
