import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import path from "node:path"
import { z } from "zod"
import {
  addComponentVariant,
  cloneComponentVariant,
  ComponentInUseError,
  createComponent,
  deleteComponent,
  deleteComponentVariant,
  getComponentById,
  getComponentWithVariants,
  getComponentUsage,
  listComponents,
  mapComponentResponse,
  replaceComponentUsageVariant,
  syncComponentUsageToSite,
  updateComponent,
  updateComponentPropsSchema,
  syncComponentPropsToCode,
  updateComponentVariant,
} from "../db/components.js"
import { saveMediaUpload } from "../lib/media-upload.js"
import { normalizePropsSchema, componentPropTypes } from "../lib/component-prop-schema.js"
import { resolveComponentPreviewDir } from "../lib/paths.js"
import {
  buildComponentPreviewUrl,
  ensureComponentDevServer,
  getComponentDevServerStatus,
  stopComponentDevServer,
} from "../lib/component-dev-server.js"
import type { AppBindings } from "../middleware/auth.js"
import { authMiddleware } from "../middleware/auth.js"

const repeaterFieldDefinitionSchema = z.object({
  type: z.enum(["text", "boolean", "textarea", "number", "date", "media", "richText", "image", "link"]),
  label: z.string().min(1),
})

const componentPropDefinitionSchema = z.object({
  type: z.enum(componentPropTypes),
  label: z.string().min(1),
  fields: z.record(repeaterFieldDefinitionSchema).optional(),
  components: z.array(z.string().min(1)).optional(),
})

const updatePropsSchema = z.object({
  variantSlug: z.string().min(1),
  schema: z.record(componentPropDefinitionSchema),
})

const syncPropsSchema = z.object({
  variantSlug: z.string().min(1),
})

const createComponentSchema = z.object({
  title: z.string().min(1),
  icon: z.string().optional(),
  kind: z.enum(["template", "layout", "form"]).optional(),
})

const updateComponentSchema = z.object({
  title: z.string().min(1).optional(),
  icon: z.string().optional(),
})

const createVariantSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  previewProps: z.record(z.unknown()).optional(),
})

const cloneVariantSchema = z.object({
  name: z.string().min(1).optional(),
})

const updateVariantSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().optional(),
  previewProps: z.record(z.unknown()).optional(),
})

const replaceUsageVariantSchema = z.object({
  variantSlug: z.string().min(1),
  props: z.record(z.unknown()).optional(),
})

export const componentsRoutes = new Hono<AppBindings>()
  .use("*", authMiddleware)
  .get("/dev/status", (c) => {
    const status = getComponentDevServerStatus()
    const env = c.get("env")

    return c.json({
      ...status,
      url: status.url ?? `http://${env.COMPONENT_PREVIEW_DEV_HOST}:${env.COMPONENT_PREVIEW_DEV_PORT}`,
    })
  })
  .post("/dev/start", async (c) => {
    try {
      const result = await ensureComponentDevServer(c.get("env"), c.get("db"))
      return c.json(result)
    } catch (error) {
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : "Failed to start component dev server",
      })
    }
  })
  .post("/dev/stop", async (c) => {
    const result = await stopComponentDevServer()
    return c.json(result)
  })
  .post("/media", async (c) => {
    const body = await c.req.parseBody()
    const file = body.file

    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: "Image file is required" })
    }

    const previewDir = resolveComponentPreviewDir(c.get("env").COMPONENT_PREVIEW_DIR)
    const mediaDir = path.join(previewDir, "public", "media")
    const saved = await saveMediaUpload(mediaDir, file)

    return c.json(saved)
  })
  .get("/", async (c) => {
    const items = await listComponents(c.get("db"), c.get("env"))
    const componentsList = await Promise.all(
      items.map((item) => mapComponentResponse(c.get("db"), c.get("env"), item)),
    )

    return c.json({ components: componentsList })
  })
  .get("/:id", async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component })
  })
  .get("/:id/usage", async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const component = await getComponentById(c.get("db"), componentId)

    if (!component) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const usage = await getComponentUsage(c.get("db"), componentId)

    return c.json({
      usage: usage.map((item) => ({
        blockId: String(item.blockId),
        siteId: String(item.siteId),
        siteName: item.siteName,
        pageName: item.pageName,
        pageSlug: item.pageSlug,
        variantSlug: item.variantSlug,
        props: item.props,
        context: item.context,
      })),
    })
  })
  .post("/:id/usage/sites/:siteId/sync", async (c) => {
    const componentId = Number(c.req.param("id"))
    const siteId = Number(c.req.param("siteId"))

    if (Number.isNaN(componentId) || Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid component or site id" })
    }

    const component = await getComponentById(c.get("db"), componentId)

    if (!component) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    try {
      const result = await syncComponentUsageToSite(c.get("db"), c.get("env"), componentId, siteId)

      return c.json({
        success: true,
        siteId: String(result.siteId),
        siteName: result.siteName,
        componentSlug: result.componentSlug,
        updatedPlacements: result.updatedPlacements,
        syncedForms: result.syncedForms,
      })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to update component on site",
      })
    }
  })
  .post("/:id/usage/:blockId/replace", zValidator("json", replaceUsageVariantSchema), async (c) => {
    const sourceComponentId = Number(c.req.param("id"))
    const blockId = Number(c.req.param("blockId"))

    if (Number.isNaN(sourceComponentId) || Number.isNaN(blockId)) {
      throw new HTTPException(400, { message: "Invalid component or block id" })
    }

    const { variantSlug, props } = c.req.valid("json")

    try {
      const result = await replaceComponentUsageVariant(
        c.get("db"),
        c.get("env"),
        sourceComponentId,
        blockId,
        variantSlug,
        props,
      )

      return c.json({
        success: true,
        blockId: String(result.blockId),
        siteId: String(result.siteId),
        componentId: String(result.componentId),
        variantSlug: result.variantSlug,
      })
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to replace component variant",
      })
    }
  })
  .post("/", zValidator("json", createComponentSchema), async (c) => {
    const body = c.req.valid("json")
    const data = await createComponent(c.get("db"), c.get("env"), body)
    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component }, 201)
  })
  .patch("/:id", zValidator("json", updateComponentSchema), async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const body = c.req.valid("json")
    const updated = await updateComponent(c.get("db"), componentId, body)

    if (!updated) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component })
  })
  .patch("/:id/props-schema", zValidator("json", updatePropsSchema), async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const body = c.req.valid("json")

    try {
      await updateComponentPropsSchema(
        c.get("db"),
        c.get("env"),
        componentId,
        body.variantSlug,
        normalizePropsSchema(body.schema),
      )
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to update props schema",
      })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component })
  })
  .post("/:id/sync-props", zValidator("json", syncPropsSchema), async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const body = c.req.valid("json")

    try {
      await syncComponentPropsToCode(c.get("db"), c.get("env"), componentId, body.variantSlug)
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to sync props to code",
      })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component })
  })
  .delete("/:id", async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const deleted = await deleteComponent(c.get("db"), c.get("env"), componentId).catch((error) => {
      if (error instanceof ComponentInUseError) {
        throw new HTTPException(409, { message: error.message })
      }

      throw error
    })

    if (!deleted) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    return c.json({ success: true })
  })
  .get("/:id/preview/:variantSlug", async (c) => {
    const componentId = Number(c.req.param("id"))
    const variantSlug = c.req.param("variantSlug")

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const variant = data.variants.find((item) => item.slug === variantSlug)

    if (!variant) {
      throw new HTTPException(404, { message: "Variant not found" })
    }

    await ensureComponentDevServer(c.get("env"), c.get("db"))

    return c.json({
      previewUrl: buildComponentPreviewUrl(c.get("env"), data.component.slug, variant.slug),
    })
  })
  .post("/:id/variants", zValidator("json", createVariantSchema), async (c) => {
    const componentId = Number(c.req.param("id"))

    if (Number.isNaN(componentId)) {
      throw new HTTPException(400, { message: "Invalid component id" })
    }

    const body = c.req.valid("json")
    await addComponentVariant(c.get("db"), c.get("env"), componentId, body)

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component }, 201)
  })
  .post("/:id/variants/:variantSlug/clone", zValidator("json", cloneVariantSchema), async (c) => {
    const componentId = Number(c.req.param("id"))
    const variantSlug = c.req.param("variantSlug")

    if (Number.isNaN(componentId) || !variantSlug) {
      throw new HTTPException(400, { message: "Invalid component or variant slug" })
    }

    try {
      await cloneComponentVariant(c.get("db"), c.get("env"), componentId, variantSlug, c.req.valid("json"))
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to clone variant",
      })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component }, 201)
  })
  .patch("/:id/variants/:variantSlug", zValidator("json", updateVariantSchema), async (c) => {
    const componentId = Number(c.req.param("id"))
    const variantSlug = c.req.param("variantSlug")

    if (Number.isNaN(componentId) || !variantSlug) {
      throw new HTTPException(400, { message: "Invalid component or variant slug" })
    }

    const body = c.req.valid("json")
    const nextSlug = await updateComponentVariant(c.get("db"), c.get("env"), componentId, variantSlug, body)

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component, variantSlug: nextSlug })
  })
  .delete("/:id/variants/:variantSlug", async (c) => {
    const componentId = Number(c.req.param("id"))
    const variantSlug = c.req.param("variantSlug")

    if (Number.isNaN(componentId) || !variantSlug) {
      throw new HTTPException(400, { message: "Invalid component or variant slug" })
    }

    try {
      await deleteComponentVariant(c.get("db"), c.get("env"), componentId, variantSlug)
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to delete variant",
      })
    }

    const data = await getComponentWithVariants(c.get("db"), c.get("env"), componentId)

    if (!data) {
      throw new HTTPException(404, { message: "Component not found" })
    }

    const component = await mapComponentResponse(c.get("db"), c.get("env"), data, { includeCode: true })

    return c.json({ component })
  })
