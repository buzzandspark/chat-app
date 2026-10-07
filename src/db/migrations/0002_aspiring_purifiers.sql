ALTER TABLE `messages` ADD `last_seq` integer;--> statement-breakpoint
CREATE INDEX `feedback_user_idx` ON `feedback` (`user_id`);--> statement-breakpoint
CREATE INDEX `generations_user_idx` ON `generations` (`user_id`);--> statement-breakpoint
CREATE INDEX `users_created_idx` ON `users` (`created_at`);