CREATE TABLE "site_layout_blocks" (
  "id" serial PRIMARY KEY,
  "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "component_id" integer NOT NULL REFERENCES "components"("id") ON DELETE RESTRICT,
  "variant_slug" text NOT NULL,
  "props" jsonb NOT NULL DEFAULT '{}',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);

CREATE INDEX "site_layout_blocks_site_id_idx" ON "site_layout_blocks" ("site_id");
