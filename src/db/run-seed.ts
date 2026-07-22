import "dotenv/config"
import { z } from "zod"
import { createDb, migrateDb } from "./index.js"
import { createAdminUser } from "./seed.js"
import { loadEnv } from "../env.js"

const argsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
})

const [, , emailArg, passwordArg, nameArg] = process.argv

if (!emailArg || !passwordArg) {
  console.error("Usage: npm run db:seed -- <email> <password> [name]")
  process.exit(1)
}

const { email, password, name } = argsSchema.parse({
  email: emailArg,
  password: passwordArg,
  name: nameArg,
})

const env = loadEnv()

await migrateDb(env.DATABASE_URL)

const { db, sql } = createDb(env.DATABASE_URL)

const user = await createAdminUser(db, { email, password, name })

await sql.end()

console.log(`Admin user created: ${user.email}`)
