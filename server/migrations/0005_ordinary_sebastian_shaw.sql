CREATE TABLE `email_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`data` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_assets_token_unique` ON `email_assets` (`token`);--> statement-breakpoint
CREATE TABLE `email_layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`design` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `drafts` ADD `email_design` text;