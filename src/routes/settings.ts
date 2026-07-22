import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getAppSettings, updateAppSettings } from "../db/settings.js"
import type { AppBindings } from "../middleware/auth.js"
import { authMiddleware } from "../middleware/auth.js"

const gitUrlSchema = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("https://") ||
      value.startsWith("http://") ||
      value.startsWith("git@"),
    { message: "Enter a valid HTTPS or SSH git URL" },
  )

const updateSettingsSchema = z.object({
  starterGitUrl: z.union([gitUrlSchema, z.literal("")]).nullable().optional(),
  starterGitBranch: z.string().min(1).optional(),
})

export const settingsRoutes = new Hono<AppBindings>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const settings = await getAppSettings(c.get("db"))

    return c.json({
      settings: {
        starterGitUrl: settings.starterGitUrl ?? "",
        starterGitBranch: settings.starterGitBranch,
        updatedAt: settings.updatedAt,
      },
    })
  })
  .patch("/", zValidator("json", updateSettingsSchema), async (c) => {
    const body = c.req.valid("json")
    const current = await getAppSettings(c.get("db"))

    const starterGitUrl =
      body.starterGitUrl === undefined
        ? current.starterGitUrl
        : body.starterGitUrl === ""
          ? null
          : body.starterGitUrl

    const settings = await updateAppSettings(c.get("db"), {
      starterGitUrl,
      starterGitBranch: body.starterGitBranch ?? current.starterGitBranch,
    })

    return c.json({
      settings: {
        starterGitUrl: settings.starterGitUrl ?? "",
        starterGitBranch: settings.starterGitBranch,
        updatedAt: settings.updatedAt,
      },
    })
  })
