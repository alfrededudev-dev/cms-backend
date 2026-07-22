import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { migrateDb } from "../dist/db/index.js"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(scriptDir, "..")

dotenv.config({ path: path.join(backendRoot, ".env") })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

await migrateDb(databaseUrl)
console.log("Migrations applied")
