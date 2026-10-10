CREATE TABLE `app_state` (
	`app_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`app_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `installation` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`created_by_version` text NOT NULL
);
