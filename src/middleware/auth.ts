import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import type { Env } from "../env.js"
import type { Db } from "../db/index.js"
import { verifyAccessToken } from "../lib/jwt.js"

export type AppBindings = {
  Bindings: Record<string, never>
  Variables: {
    env: Env
    db: Db
    user: {
      id: number
      email: string
      name: string
      role: "admin"
    }
  }
}

export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const authorization = c.req.header("Authorization")

  if (!authorization?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Unauthorized" })
  }

  const token = authorization.slice("Bearer ".length)

  try {
    const payload = await verifyAccessToken(token, c.get("env").JWT_SECRET)
    c.set("user", {
      id: Number(payload.sub),
      email: payload.email,
      name: payload.name,
      role: payload.role,
    })
    await next()
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" })
  }
})
