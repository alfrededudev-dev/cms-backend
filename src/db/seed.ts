import { eq } from "drizzle-orm"
import type { Db } from "./index.js"
import { users } from "./schema.js"
import { hashPassword } from "../lib/password.js"

type CreateAdminUserInput = {
  email: string
  password: string
  name?: string
}

export async function createAdminUser(db: Db, input: CreateAdminUserInput) {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email))

  if (existing) {
    throw new Error(`User with email ${input.email} already exists`)
  }

  const passwordHash = await hashPassword(input.password)
  const createdAt = new Date().toISOString()

  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      name: input.name ?? "Administrator",
      role: "admin",
      createdAt,
    })
    .returning()

  if (!user) {
    throw new Error("Failed to create admin user")
  }

  return user
}
