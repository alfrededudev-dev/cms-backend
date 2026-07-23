import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { logger } from "hono/logger"
import { createDb, migrateDb } from "./db/index.js"
import type { Env } from "./env.js"
import type { AppBindings } from "./middleware/auth.js"
import { authRoutes } from "./routes/auth.js"
import { settingsRoutes } from "./routes/settings.js"
import { sitesRoutes } from "./routes/sites.js"
import { componentsRoutes } from "./routes/components.js"
import { applicationsRoutes } from "./routes/applications.js"
import { publicFormsRoutes } from "./routes/public-forms.js"
import { parseCorsOrigins, resolveCorsOrigin } from "./lib/cors-origins.js"

export async function createApp(env: Env) {
  await migrateDb(env.DATABASE_URL)

  const { db, sql } = createDb(env.DATABASE_URL)

  const app = new Hono<AppBindings>()

  const allowedOrigins = parseCorsOrigins(env.CORS_ORIGIN)

  app.use("*", logger())
  app.use(
    "*",
    cors({
      origin: (origin) => resolveCorsOrigin(origin, allowedOrigins),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  )

  app.use("*", async (c, next) => {
    c.set("env", env)
    c.set("db", db)
    await next()
  })
  

  app.get("/health", (c) => c.json({ status: "ok" }))

  app.route("/api/auth", authRoutes)
  app.route("/api/settings", settingsRoutes)
  app.route("/api/public", publicFormsRoutes)
  app.route("/api/applications", applicationsRoutes)
  app.route("/api/sites", sitesRoutes)
  app.route("/api/components", componentsRoutes)

  app.notFound((c) => c.json({ message: "Not found" }, 404))

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }

    console.error(error)
    return c.json({ message: "Internal server error" }, 500)
  })

  return { app, sql }
}
