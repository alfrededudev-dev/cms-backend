ALTER TABLE "site_page_blocks" ADD COLUMN IF NOT EXISTS "theme_color_map" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "site_layout_blocks" ADD COLUMN IF NOT EXISTS "theme_color_map" jsonb DEFAULT '{}'::jsonb NOT NULL;
