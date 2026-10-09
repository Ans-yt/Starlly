CREATE TABLE `app_auth` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`session_secret` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `business` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`since_date` text,
	`google_review_url` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`social_links` text DEFAULT '{}' NOT NULL,
	`field_sources` text DEFAULT '{}' NOT NULL,
	`profile_fields` text DEFAULT '[]' NOT NULL,
	`place_id` text,
	`google_rating` real,
	`google_review_count` integer,
	`email_adapter_id` text DEFAULT 'copy-only' NOT NULL,
	`email_config` text DEFAULT '{}' NOT NULL,
	`ai_style` text,
	`ai_base_url` text,
	`ai_model` text,
	`ai_api_key` text,
	`exa_api_key` text,
	`google_places_api_key` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`service_type` text DEFAULT '' NOT NULL,
	`last_job_date` text,
	`consent` integer DEFAULT false NOT NULL,
	`consent_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`call_resolved_at` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`customer_id` text,
	`request_id` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_at` text,
	`content_hash` text DEFAULT '' NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `embed_cache` (
	`hash` text PRIMARY KEY NOT NULL,
	`vector` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_request_idx` ON `events` (`request_id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`kind` text DEFAULT 'call_outcome' NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`draft_id` text,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`sent_at` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_token_idx` ON `requests` (`token`);--> statement-breakpoint
CREATE INDEX `requests_customer_idx` ON `requests` (`customer_id`);--> statement-breakpoint
CREATE TABLE `review_themes` (
	`review_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`similarity` real,
	PRIMARY KEY(`review_id`, `theme_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`rating` integer,
	`review_date` text,
	`text` text NOT NULL,
	`request_id` text,
	`sentiment` text,
	`sentiment_confidence` real,
	`replied` integer DEFAULT false NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_source_idx` ON `reviews` (`source`);--> statement-breakpoint
CREATE TABLE `send_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`to` text NOT NULL,
	`provider` text NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`provider_message_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_jobs_draft_test_idx` ON `send_jobs` (`draft_id`,`is_test`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
