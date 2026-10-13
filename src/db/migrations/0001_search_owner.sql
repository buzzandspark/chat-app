ALTER TABLE `messages` ADD `search_owner` text;--> statement-breakpoint
-- The search index gains the owner's id (hex: one token no word shares), so a search reads one user's postings,
-- and 2- and 3-letter prefix indexes.
-- A message is in the index exactly when `search_owner` is set; the triggers keep that true.
DROP TRIGGER IF EXISTS `messages_search_text_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `messages_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `messages_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `messages_fts_au`;--> statement-breakpoint
DROP TABLE IF EXISTS `messages_fts`;--> statement-breakpoint
UPDATE `messages` SET `search_owner` = (SELECT hex(`user_id`) FROM `chats` WHERE `chats`.`id` = `messages`.`chat_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `messages_fts` USING fts5(`search_text`, `search_owner`, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2', prefix='2 3');--> statement-breakpoint
INSERT INTO `messages_fts`(`messages_fts`) VALUES ('rebuild');--> statement-breakpoint
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  UPDATE `messages` SET `search_owner` = (SELECT hex(`user_id`) FROM `chats` WHERE `id` = NEW.`chat_id`), `search_text` = (SELECT group_concat(json_extract(j.value, '$.text'), ' ') FROM json_each(NEW.`content`) AS j WHERE json_extract(j.value, '$.type') = 'text') WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` WHEN OLD.`search_owner` IS NOT NULL BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `search_text`, `search_owner`) VALUES ('delete', OLD.`rowid`, coalesce(OLD.`search_text`, ''), OLD.`search_owner`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF `search_text`, `search_owner` ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `search_text`, `search_owner`) SELECT 'delete', OLD.`rowid`, coalesce(OLD.`search_text`, ''), OLD.`search_owner` WHERE OLD.`search_owner` IS NOT NULL;
  INSERT INTO `messages_fts`(`rowid`, `search_text`, `search_owner`) SELECT NEW.`rowid`, coalesce(NEW.`search_text`, ''), NEW.`search_owner` WHERE NEW.`search_owner` IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER `chats_search_owner_au` AFTER UPDATE OF `user_id` ON `chats` BEGIN
  UPDATE `messages` SET `search_owner` = hex(NEW.`user_id`) WHERE `chat_id` = NEW.`id`;
END;
