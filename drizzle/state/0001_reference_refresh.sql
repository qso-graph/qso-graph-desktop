CREATE TABLE `reference_refresh` (
	`source_id` text PRIMARY KEY NOT NULL,
	`last_attempt` text,
	`last_check` text,
	`last_failure` text
);
