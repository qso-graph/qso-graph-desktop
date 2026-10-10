CREATE TABLE `data_type` (
	`name` text PRIMARY KEY NOT NULL,
	`indicator` text,
	`description` text NOT NULL,
	`minimum_value` text,
	`maximum_value` text,
	`import_only` integer DEFAULT false NOT NULL,
	`comments` text
);
--> statement-breakpoint
CREATE TABLE `enumeration` (
	`name` text PRIMARY KEY NOT NULL,
	`header` text NOT NULL,
	`value_column` text NOT NULL,
	`row_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enumeration_value` (
	`enumeration` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`import_only` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`enumeration`, `key`),
	FOREIGN KEY (`enumeration`) REFERENCES `enumeration`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `field` (
	`name` text PRIMARY KEY NOT NULL,
	`data_type` text NOT NULL,
	`data_types` text NOT NULL,
	`enumeration_ref` text,
	`enumeration_name` text,
	`enumeration_parameter` text,
	`description` text NOT NULL,
	`header_field` integer DEFAULT false NOT NULL,
	`minimum_value` text,
	`maximum_value` text,
	`import_only` integer DEFAULT false NOT NULL,
	`comments` text
);
--> statement-breakpoint
CREATE TABLE `list` (
	`id` text PRIMARY KEY NOT NULL,
	`what` text NOT NULL,
	`authority` text NOT NULL,
	`copy` text NOT NULL,
	`source_id` text,
	`supplied` integer NOT NULL,
	`derived` integer NOT NULL,
	`row_count` integer
);
--> statement-breakpoint
CREATE TABLE `pota_location` (
	`location_id` integer PRIMARY KEY NOT NULL,
	`entity_id` integer,
	`entity_name` text,
	`location_desc` text NOT NULL,
	`location_name` text,
	`latitude` real,
	`longitude` real,
	`iso` text
);
--> statement-breakpoint
CREATE TABLE `pota_park` (
	`reference` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer NOT NULL,
	`entity_id` integer,
	`adif_entity` integer,
	`location_desc` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`grid` text,
	`coordinates_usable` integer NOT NULL,
	`coordinates_note` text,
	`is_test` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pota_park_location` (
	`reference` text NOT NULL,
	`location_desc` text NOT NULL,
	PRIMARY KEY(`reference`, `location_desc`)
);
--> statement-breakpoint
CREATE TABLE `pota_program` (
	`program_id` integer PRIMARY KEY NOT NULL,
	`prefix` text NOT NULL,
	`name` text NOT NULL,
	`active` integer NOT NULL,
	`iso_country` text,
	`location_unit` text,
	`iso_language` text
);
--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`what` text NOT NULL,
	`url` text NOT NULL,
	`version` text,
	`sha256` text,
	`published` text,
	`etag` text,
	`last_modified` text,
	`fetched_at` text NOT NULL,
	`row_count` integer NOT NULL,
	`content_sha256` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uninterpreted` (
	`source_id` text NOT NULL,
	`relation` text NOT NULL,
	`key` text NOT NULL,
	`column` text NOT NULL,
	`cell` text NOT NULL,
	`note` text NOT NULL,
	PRIMARY KEY(`relation`, `key`, `column`)
);
--> statement-breakpoint
CREATE TABLE `zone` (
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`authority` text NOT NULL,
	`derived_from` text NOT NULL,
	`subdivisions` integer NOT NULL,
	PRIMARY KEY(`kind`, `number`)
);
