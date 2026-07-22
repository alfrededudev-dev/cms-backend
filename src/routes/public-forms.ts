import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { submitSiteForm } from "../db/site-forms.js"
import { getSiteById } from "../db/sites.js"
import type { AppBindings } from "../middleware/auth.js"

const submitFormSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  pageUrl: z.string().optional(),
})

export const publicFormsRoutes = new Hono<AppBindings>().post(
  "/sites/:siteId/forms/:formSlug/submit",
  zValidator("json", submitFormSchema),
  async (c) => {
    const siteId = Number(c.req.param("siteId"))
    const formSlug = c.req.param("formSlug")

    if (Number.isNaN(siteId)) {
      throw new HTTPException(400, { message: "Invalid site id" })
    }

    const site = await getSiteById(c.get("db"), siteId)
    if (!site) {
      throw new HTTPException(404, { message: "Site not found" })
    }

    try {
      const result = await submitSiteForm(c.get("db"), c.get("env"), siteId, formSlug, c.req.valid("json"))
      return c.json(result)
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Failed to submit form",
      })
    }
  },
)
