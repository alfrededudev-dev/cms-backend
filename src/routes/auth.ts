import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { users } from "../db/schema.js"
import { signAccessToken } from "../lib/jwt.js"
import { verifyPassword } from "../lib/password.js"
import type { AppBindings } from "../middleware/auth.js"
import { authMiddleware } from "../middleware/auth.js"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const authRoutes = new Hono<AppBindings>()
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json")
    const db = c.get("db")

  const [user] = await db.select().from(users).where(eq(users.email, email))

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HTTPException(401, { message: "Invalid email or password" })
    }

    const token = await signAccessToken(
      {
        sub: String(user.id),
        email: user.email,
        name: user.name,
        role: user.role,
      },
      c.get("env").JWT_SECRET,
    )

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    })
  })
  .get("/me", authMiddleware, (c) => {
    const user = c.get("user")
    return c.json({ user })
  })
