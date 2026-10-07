ALTER TABLE `messages` ADD `search_text` text;--> statement-breakpoint
-- #60: a plain-text shadow of each message's text blocks, kept by triggers, indexed by FTS5 (external content).
UPDATE `messages` SET `search_text` = (SELECT group_concat(json_extract(j.value, '$.text'), ' ') FROM json_each(`messages`.`content`) AS j WHERE json_extract(j.value, '$.type') = 'text');--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_search_text_ai` AFTER INSERT ON `messages` BEGIN
  UPDATE `messages` SET `search_text` = (SELECT group_concat(json_extract(j.value, '$.text'), ' ') FROM json_each(NEW.`content`) AS j WHERE json_extract(j.value, '$.type') = 'text') WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_search_text_au` AFTER UPDATE OF `content` ON `messages` BEGIN
  UPDATE `messages` SET `search_text` = (SELECT group_concat(json_extract(j.value, '$.text'), ' ') FROM json_each(NEW.`content`) AS j WHERE json_extract(j.value, '$.type') = 'text') WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `messages_fts` USING fts5(`search_text`, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
INSERT INTO `messages_fts`(`rowid`, `search_text`) SELECT `rowid`, coalesce(`search_text`, '') FROM `messages`;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts`(`rowid`, `search_text`) VALUES (NEW.`rowid`, coalesce(NEW.`search_text`, ''));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `search_text`) VALUES ('delete', OLD.`rowid`, coalesce(OLD.`search_text`, ''));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_au` AFTER UPDATE OF `search_text` ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `search_text`) VALUES ('delete', OLD.`rowid`, coalesce(OLD.`search_text`, ''));
  INSERT INTO `messages_fts`(`rowid`, `search_text`) VALUES (NEW.`rowid`, coalesce(NEW.`search_text`, ''));
END;
