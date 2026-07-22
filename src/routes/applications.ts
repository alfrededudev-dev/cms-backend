import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import {
  deleteApplication,
  getApplication,
  listAllApplications,
  updateApplicationStatus,
} from "../db/site-forms.js"
import type { AppBindings } from "../middleware/auth.js"
import { authMiddleware } from "../middleware/auth.js"

const updateApplicationSchema = z.object({
  status: z.enum(["new", "in_progress", "completed", "spam"]),
})

export const applicationsRoutes = new Hono<AppBindings>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const applications = await listAllApplications(c.get("db"))
    return c.json({ applications })
  })
  .get("/:applicationId", async (c) => {
    const applicationId = Number(c.req.param("applicationId"))
    if (Number.isNaN(applicationId)) {
      throw new HTTPException(400, { message: "Invalid application id" })
    }

    const application = await getApplication(c.get("db"), applicationId)
    if (!application) {
      throw new HTTPException(404, { message: "Application not found" })
    }

    return c.json({ application })
  })
  .patch("/:applicationId", zValidator("json", updateApplicationSchema), async (c) => {
    const applicationId = Number(c.req.param("applicationId"))
    if (Number.isNaN(applicationId)) {
      throw new HTTPException(400, { message: "Invalid application id" })
    }

    const application = await updateApplicationStatus(
      c.get("db"),
      applicationId,
      c.req.valid("json").status,
    )

    if (!application) {
      throw new HTTPException(404, { message: "Application not found" })
    }

    return c.json({ application })
  })
  .delete("/:applicationId", async (c) => {
    const applicationId = Number(c.req.param("applicationId"))
    if (Number.isNaN(applicationId)) {
      throw new HTTPException(400, { message: "Invalid application id" })
    }

    const deleted = await deleteApplication(c.get("db"), applicationId)
    if (!deleted) {
      throw new HTTPException(404, { message: "Application not found" })
    }

    return c.json({ success: true })
  })
