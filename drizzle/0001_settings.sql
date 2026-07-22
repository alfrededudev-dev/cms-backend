CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"starter_git_url" text,
	"starter_git_branch" text DEFAULT 'main' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

INSERT INTO "app_settings" ("id", "starter_git_url", "starter_git_branch", "updated_at")
VALUES (1, NULL, 'main', NOW())
ON CONFLICT ("id") DO NOTHING;
