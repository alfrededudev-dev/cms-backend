CREATE TABLE "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"site_health" text DEFAULT 'offline' NOT NULL,
	"forms_status" text DEFAULT 'no_forms' NOT NULL,
	"workspace_path" text,
	"clone_status" text DEFAULT 'pending' NOT NULL,
	"clone_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sites_domain_unique" UNIQUE("domain")
);
