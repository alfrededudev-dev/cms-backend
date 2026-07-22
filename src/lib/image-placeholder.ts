export const IMAGE_PLACEHOLDER_URL = "https://placehold.co/1000x1000"

export function resolveImageSrc(src?: string | null) {
  const trimmed = String(src ?? "").trim()
  return trimmed || IMAGE_PLACEHOLDER_URL
}
