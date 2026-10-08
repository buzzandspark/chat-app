-- Chat groups are removed: drop `chat_groups`, and rebuild `chats` without `group_id` (SQLite cannot drop a
-- column that carries a foreign key). Chats that sat in a group stay, ungrouped. Safe under applyMigrations:
-- foreign keys are off for the whole run, so dropping `chats` cascades into nothing.
DROP TABLE `chat_groups`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_message_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chats`("id", "user_id", "title", "pinned", "created_at", "updated_at", "last_message_at") SELECT "id", "user_id", "title", "pinned", "created_at", "updated_at", "last_message_at" FROM `chats`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chats_user_updated_idx` ON `chats` (`user_id`,`updated_at`);