ALTER TABLE `app_state` RENAME TO `extension_state`;--> statement-breakpoint
ALTER TABLE `extension_state` RENAME COLUMN `app_id` TO `extension_id`;
