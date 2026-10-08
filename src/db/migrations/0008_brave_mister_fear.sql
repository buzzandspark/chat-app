CREATE TABLE `chat_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_groups_user_idx` ON `chat_groups` (`user_id`,`position`);--> statement-breakpoint
ALTER TABLE `chats` ADD `group_id` text REFERENCES chat_groups(id);