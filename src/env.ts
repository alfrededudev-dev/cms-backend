import { z } from "zod"

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:root@localhost:5432/cms_site_db"),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default("*"),
  CMS_PUBLIC_URL: z.string().default("http://localhost:3000"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  WORKSPACES_DIR: z.string().default("../workspaces"),
  COMPONENT_PREVIEW_DIR: z.string().default("../workspaces/component-preview"),
  COMPONENT_PREVIEW_DEV_PORT: z.coerce.number().default(4322),
  COMPONENT_PREVIEW_DEV_HOST: z.string().default("localhost"),
  ASTRO_STARTER_DIR: z.string().default("../astro-starter"),
  COMPONENT_PREVIEW_ASSETS_DIR: z.string().default("../component-preview-assets"),
  SITE_DEV_PORT_BASE: z.coerce.number().default(4500),
  SITE_DEV_HOST: z.string().default("localhost"),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(): Env {
  return envSchema.parse(process.env)
}
