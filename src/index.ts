import "dotenv/config"
import { serve } from "@hono/node-server"
import { createApp } from "./app.js"
import { loadEnv } from "./env.js"

const env = loadEnv()
const { app, sql } = await createApp(env)

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`CMS API running on http://localhost:${info.port}`)
  },
)

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${env.PORT} is already in use.`)
    console.error("Run npm run dev — it detects an existing CMS server automatically.")
    console.error("To restart: npm run dev:stop && npm run dev")
    process.exit(1)
  }

  throw error
})

process.on("SIGINT", async () => {
  await sql.end()
  process.exit(0)
})
