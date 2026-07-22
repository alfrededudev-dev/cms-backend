import fs from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
])

const ALLOWED_IMAGE_MIME_PREFIX = "image/"

function sanitizeBaseName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function getExtension(fileName: string, mimeType?: string) {
  const extension = path.extname(fileName).toLowerCase()

  if (ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return extension
  }

  if (mimeType === "image/jpeg") return ".jpg"
  if (mimeType === "image/png") return ".png"
  if (mimeType === "image/gif") return ".gif"
  if (mimeType === "image/webp") return ".webp"
  if (mimeType === "image/svg+xml") return ".svg"
  if (mimeType === "image/avif") return ".avif"
  if (mimeType === "image/bmp") return ".bmp"
  if (mimeType === "image/x-icon" || mimeType === "image/vnd.microsoft.icon") return ".ico"
  if (mimeType === "image/tiff") return ".tiff"
  if (mimeType === "image/heic") return ".heic"
  if (mimeType === "image/heif") return ".heif"

  return ".jpg"
}

export async function saveMediaUpload(
  mediaDir: string,
  file: File,
  options: { publicUrlPrefix?: string } = {},
) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("No file uploaded")
  }

  const mimeType = file.type?.toLowerCase() ?? ""

  if (mimeType && !mimeType.startsWith(ALLOWED_IMAGE_MIME_PREFIX)) {
    throw new Error("Only image files are allowed")
  }

  const extension = getExtension(file.name || "image.jpg", mimeType)
  const baseName = sanitizeBaseName(path.basename(file.name || "image", extension)) || "image"
  const uniqueSuffix = randomBytes(4).toString("hex")
  const filename = `${baseName}-${uniqueSuffix}${extension}`

  await fs.mkdir(mediaDir, { recursive: true })

  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(mediaDir, filename), buffer)

  const prefix = options.publicUrlPrefix ?? "/media"
  const url = `${prefix.replace(/\/$/, "")}/${filename}`

  return { url, filename }
}
