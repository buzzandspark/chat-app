CREATE TABLE `spend_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`level_usd` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `budget_keys` text;