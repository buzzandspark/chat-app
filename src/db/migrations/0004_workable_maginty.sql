-- Demo visitors were anonymous users with role 'demo'; the demo path is gone, so their rows (and, by cascade, their sessions, chats, messages and usage) go with it.
DELETE FROM `users` WHERE `role` = 'demo';--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_anonymous`;
