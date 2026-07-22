ALTER TABLE "sites" ADD COLUMN "git_remote_url" text;
ALTER TABLE "sites" ADD COLUMN "git_branch" text DEFAULT 'main' NOT NULL;
