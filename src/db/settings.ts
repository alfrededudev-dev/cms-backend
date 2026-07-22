import { eq } from "drizzle-orm"
import type { Db } from "./index.js"
import { appSettings } from "./schema.js"

const SETTINGS_ID = 1

export async function getAppSettings(db: Db) {
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID))

  if (!settings) {
    const createdAt = new Date().toISOString()
    const [created] = await db
      .insert(appSettings)
      .values({
        id: SETTINGS_ID,
        starterGitUrl: null,
        starterGitBranch: "main",
        updatedAt: createdAt,
      })
      .returning()

    return created!
  }

  return settings
}

export async function updateAppSettings(
  db: Db,
  input: {
    starterGitUrl: string | null
    starterGitBranch: string
  },
) {
  const updatedAt = new Date().toISOString()

  const [settings] = await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      starterGitUrl: input.starterGitUrl,
      starterGitBranch: input.starterGitBranch,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        starterGitUrl: input.starterGitUrl,
        starterGitBranch: input.starterGitBranch,
        updatedAt,
      },
    })
    .returning()

  if (!settings) {
    throw new Error("Failed to update settings")
  }

  return settings
}
