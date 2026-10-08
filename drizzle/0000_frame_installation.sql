CREATE SCHEMA "qg_frame";
--> statement-breakpoint
CREATE TABLE "qg_frame"."installation" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"postgres_major" integer NOT NULL,
	"created_by_version" text NOT NULL
);
