import path from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema.js"

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle")

const postgresOptions = {
  onnotice: () => {},
}

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, postgresOptions)
  const db = drizzle(sql, { schema })

  return { db, sql }
}

export type Db = ReturnType<typeof createDb>["db"]

export async function migrateDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1, ...postgresOptions })
  const db = drizzle(sql)

  await migrate(db, { migrationsFolder })
  await sql.end()
}
