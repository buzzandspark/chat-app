-- 0008 first shipped `chats.group_id` with a bare REFERENCES and was then edited to add ON DELETE SET NULL.
-- A database that ran the first version keeps the bare reference (an applied migration never runs again),
-- so rebuild `chats` as drizzle-kit would for the FK change; where 0008 already had it the result is the same.
-- Safe under applyMigrations: foreign keys are off for the whole run, so dropping `chats` cascades into nothing.
-- No triggers or FTS objects sit on `chats`; its one index is recreated at the end.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`group_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_message_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `chat_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_chats`("id", "user_id", "title", "pinned", "group_id", "created_at", "updated_at", "last_message_at") SELECT "id", "user_id", "title", "pinned", "group_id", "created_at", "updated_at", "last_message_at" FROM `chats`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chats_user_updated_idx` ON `chats` (`user_id`,`updated_at`);
