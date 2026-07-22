ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_host" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_port" integer DEFAULT 587 NOT NULL;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_user" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_password" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_from" text;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "smtp_secure" boolean DEFAULT false NOT NULL;
