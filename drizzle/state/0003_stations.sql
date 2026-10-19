CREATE TABLE `active_station` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text,
	FOREIGN KEY (`station_id`) REFERENCES `station`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `station` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text,
	`place` text NOT NULL,
	`lotw_park` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `station_name` ON `station` (`name`);--> statement-breakpoint
CREATE TABLE `station_default` (
	`persona` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `station`(`id`) ON UPDATE no action ON DELETE cascade
);
