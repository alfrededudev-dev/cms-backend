export function parseCorsOrigins(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Reflect request origin so browser preflight succeeds from any site/preview port. */
export function resolveCorsOrigin(origin: string | undefined, _allowedOrigins: string[]) {
  return origin ?? "*"
}
