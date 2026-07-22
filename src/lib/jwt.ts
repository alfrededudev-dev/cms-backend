import { SignJWT, jwtVerify } from "jose"

export type AuthTokenPayload = {
  sub: string
  email: string
  name: string
  role: "admin"
}

function getSecret(secret: string) {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(payload: AuthTokenPayload, secret: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret(secret))
}

export async function verifyAccessToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, getSecret(secret))
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    name: String(payload.name),
    role: payload.role as "admin",
  } satisfies AuthTokenPayload
}
