import { boolean, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core"
import type { DataFieldDefinition } from "../lib/data-model.js"

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin"] }).notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  starterGitUrl: text("starter_git_url"),
  starterGitBranch: text("starter_git_branch").notNull().default("main"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type User = typeof users.$inferSelect
export type AppSettings = typeof appSettings.$inferSelect

export type ThemeColorToken = {
  key: string
  value: string
}

export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  description: text("description"),
  status: text("status", { enum: ["published", "draft", "archived"] }).notNull().default("draft"),
  siteHealth: text("site_health", { enum: ["online", "offline", "degraded"] }).notNull().default("offline"),
  formsStatus: text("forms_status", { enum: ["healthy", "issues", "no_forms"] }).notNull().default("no_forms"),
  workspacePath: text("workspace_path"),
  cloneStatus: text("clone_status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
  cloneError: text("clone_error"),
  gitRemoteUrl: text("git_remote_url"),
  gitBranch: text("git_branch").notNull().default("main"),
  ftpHost: text("ftp_host"),
  ftpPort: integer("ftp_port").notNull().default(21),
  ftpUsername: text("ftp_username"),
  ftpPassword: text("ftp_password"),
  ftpRemotePath: text("ftp_remote_path"),
  ftpSecure: boolean("ftp_secure").notNull().default(false),
  sshHost: text("ssh_host"),
  sshPort: integer("ssh_port").notNull().default(22),
  sshUsername: text("ssh_username"),
  sshPassword: text("ssh_password"),
  sshRemotePath: text("ssh_remote_path"),
  customHeadStyles: text("custom_head_styles").notNull().default(""),
  customHeadLinks: text("custom_head_links").notNull().default(""),
  customHeadScripts: text("custom_head_scripts").notNull().default(""),
  customBodyScripts: text("custom_body_scripts").notNull().default(""),
  themeColors: jsonb("theme_colors").$type<ThemeColorToken[]>().notNull().default([]),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFrom: text("smtp_from"),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type Site = typeof sites.$inferSelect

export const components = pgTable("components", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  icon: text("icon").notNull().default("LayoutTemplate"),
  kind: text("kind", { enum: ["template", "layout", "form"] }).notNull().default("template"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type Component = typeof components.$inferSelect

export const siteLayouts = pgTable(
  "site_layouts",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => ({
    siteSlugUnique: unique("site_layouts_site_id_slug_unique").on(table.siteId, table.slug),
  }),
)

export type SiteLayout = typeof siteLayouts.$inferSelect

export const sitePages = pgTable(
  "site_pages",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    pageType: text("page_type", { enum: ["static", "collection"] }).notNull().default("static"),
    fieldsSchema: jsonb("fields_schema").$type<DataFieldDefinition[]>().notNull().default([]),
    fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    layoutId: integer("layout_id").references(() => siteLayouts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => ({
    siteSlugPageTypeUnique: unique("site_pages_site_id_slug_page_type_unique").on(
      table.siteId,
      table.slug,
      table.pageType,
    ),
  }),
)

export const sitePageBlocks = pgTable("site_page_blocks", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id")
    .notNull()
    .references(() => sitePages.id, { onDelete: "cascade" }),
  componentId: integer("component_id")
    .notNull()
    .references(() => components.id, { onDelete: "restrict" }),
  variantSlug: text("variant_slug").notNull(),
  props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
  themeColorMap: jsonb("theme_color_map").$type<Record<string, string>>().notNull().default({}),
  collectionEntryLoop: boolean("collection_entry_loop").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type SitePage = typeof sitePages.$inferSelect
export type SitePageBlock = typeof sitePageBlocks.$inferSelect

export const siteLayoutBlocks = pgTable("site_layout_blocks", {
  id: serial("id").primaryKey(),
  layoutId: integer("layout_id")
    .notNull()
    .references(() => siteLayouts.id, { onDelete: "cascade" }),
  componentId: integer("component_id")
    .notNull()
    .references(() => components.id, { onDelete: "restrict" }),
  variantSlug: text("variant_slug").notNull(),
  props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
  themeColorMap: jsonb("theme_color_map").$type<Record<string, string>>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type SiteLayoutBlock = typeof siteLayoutBlocks.$inferSelect

export const siteCollections = pgTable("site_collections", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["collection", "single", "global"] }).notNull().default("collection"),
  fieldsSchema: jsonb("fields_schema").$type<DataFieldDefinition[]>().notNull().default([]),
  singleData: jsonb("single_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const siteCollectionEntries = pgTable("site_collection_entries", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => siteCollections.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  body: text("body"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type SiteCollection = typeof siteCollections.$inferSelect
export type SiteCollectionEntry = typeof siteCollectionEntries.$inferSelect

export type SiteFormSettings = {
  successMessage?: string
  redirectUrl?: string
  notifyEmail?: string
  honeypotField?: string
  /** Field keys hidden on the live site (definitions still synced from the form component). */
  disabledFieldKeys?: string[]
}

export const siteForms = pgTable("site_forms", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  fieldsSchema: jsonb("fields_schema").$type<DataFieldDefinition[]>().notNull().default([]),
  settings: jsonb("settings").$type<SiteFormSettings>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type ApplicationStatus = "new" | "in_progress" | "completed" | "spam"

export const siteFormSubmissions = pgTable("site_form_submissions", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  formId: integer("form_id")
    .notNull()
    .references(() => siteForms.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["new", "in_progress", "completed", "spam"] }).notNull().default("new"),
  pageUrl: text("page_url"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export type SiteForm = typeof siteForms.$inferSelect
export type SiteFormSubmission = typeof siteFormSubmissions.$inferSelect
