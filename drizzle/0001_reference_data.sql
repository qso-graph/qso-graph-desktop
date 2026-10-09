CREATE SCHEMA "qg_ref";
--> statement-breakpoint
CREATE TABLE "qg_ref"."data_type" (
	"name" text PRIMARY KEY NOT NULL,
	"indicator" text,
	"description" text NOT NULL,
	"minimum_value" text,
	"maximum_value" text,
	"import_only" boolean DEFAULT false NOT NULL,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."enumeration" (
	"name" text PRIMARY KEY NOT NULL,
	"header" text[] NOT NULL,
	"value_column" text NOT NULL,
	"row_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."enumeration_value" (
	"enumeration" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"import_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "enumeration_value_enumeration_key_pk" PRIMARY KEY("enumeration","key")
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."field" (
	"name" text PRIMARY KEY NOT NULL,
	"data_type" text NOT NULL,
	"data_types" text[] NOT NULL,
	"enumeration_ref" text,
	"enumeration_name" text,
	"enumeration_parameter" text,
	"description" text NOT NULL,
	"header_field" boolean DEFAULT false NOT NULL,
	"minimum_value" text,
	"maximum_value" text,
	"import_only" boolean DEFAULT false NOT NULL,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."list" (
	"id" text PRIMARY KEY NOT NULL,
	"what" text NOT NULL,
	"authority" text NOT NULL,
	"copy" text NOT NULL,
	"source_id" text,
	"supplied" boolean NOT NULL,
	"derived" boolean NOT NULL,
	"row_count" integer
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."source" (
	"id" text PRIMARY KEY NOT NULL,
	"what" text NOT NULL,
	"url" text NOT NULL,
	"version" text,
	"sha256" text,
	"published" text,
	"etag" text,
	"last_modified" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."uninterpreted" (
	"source_id" text NOT NULL,
	"relation" text NOT NULL,
	"key" text NOT NULL,
	"column" text NOT NULL,
	"cell" text NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "uninterpreted_relation_key_column_pk" PRIMARY KEY("relation","key","column")
);
--> statement-breakpoint
CREATE TABLE "qg_ref"."zone" (
	"kind" text NOT NULL,
	"number" integer NOT NULL,
	"authority" text NOT NULL,
	"derived_from" text NOT NULL,
	"subdivisions" integer NOT NULL,
	CONSTRAINT "zone_kind_number_pk" PRIMARY KEY("kind","number")
);
--> statement-breakpoint
ALTER TABLE "qg_ref"."enumeration_value" ADD CONSTRAINT "enumeration_value_enumeration_enumeration_name_fk" FOREIGN KEY ("enumeration") REFERENCES "qg_ref"."enumeration"("name") ON DELETE no action ON UPDATE no action;