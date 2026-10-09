ALTER TABLE `chats` ADD `forked_from` text REFERENCES chats(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `fork_position` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `fork_order` integer;--> statement-breakpoint
CREATE INDEX `chats_forked_from_idx` ON `chats` (`forked_from`);--> statement-breakpoint
ALTER TABLE `messages` ADD `thinking` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `fork_options` text;