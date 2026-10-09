CREATE TABLE `insight_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`summary` text NOT NULL,
	`quotes` text NOT NULL,
	`dropped_quotes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
