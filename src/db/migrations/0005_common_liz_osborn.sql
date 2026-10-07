PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text,
	`user_id` text NOT NULL,
	`model` text NOT NULL,
	`iteration_type` text DEFAULT 'message' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`estimated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "generation_id", "user_id", "model", "iteration_type", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "estimated", "created_at") SELECT "id", "generation_id", "user_id", "model", "iteration_type", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "estimated", "created_at" FROM `usage_events`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usage_user_idx` ON `usage_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `usage_generation_idx` ON `usage_events` (`generation_id`);