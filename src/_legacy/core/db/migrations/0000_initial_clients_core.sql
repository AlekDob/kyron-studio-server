CREATE TYPE "public"."client_lifecycle_stage" AS ENUM('prospect', 'active', 'inactive', 'churned', 'blacklisted');--> statement-breakpoint
CREATE TYPE "public"."client_activity_kind" AS ENUM('note', 'call', 'email', 'meeting', 'document_uploaded', 'agent_insight', 'status_change', 'opportunity_created');--> statement-breakpoint
CREATE TYPE "public"."client_activity_actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."opportunity_creator" AS ENUM('rule_engine', 'agent');--> statement-breakpoint
CREATE TYPE "public"."opportunity_signal" AS ENUM('churn_risk', 'contract_expiry', 'silence_anomaly', 'upsell_trigger', 'renewal_due');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('pending', 'acted', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."custom_field_entity" AS ENUM('client', 'contact', 'activity', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'boolean', 'date', 'enum', 'url', 'email', 'phone', 'multiselect');--> statement-breakpoint
CREATE TYPE "public"."external_source_status" AS ENUM('active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."external_source_type" AS ENUM('hubspot', 'pipedrive', 'salesforce', 'postgres_direct', 'mysql_direct', 'csv_import');--> statement-breakpoint
CREATE TYPE "public"."sync_direction" AS ENUM('pull', 'push', 'bidirectional');--> statement-breakpoint
CREATE TYPE "public"."brain_scope" AS ENUM('org', 'client');--> statement-breakpoint
CREATE TYPE "public"."brain_source_type" AS ENUM('pdf', 'docx', 'md', 'txt', 'html', 'note', 'memory');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"vat_number" text,
	"fiscal_code" text,
	"website" text,
	"industry" text,
	"country" text,
	"region" text,
	"city" text,
	"address" text,
	"lifecycle_stage" "client_lifecycle_stage" DEFAULT 'prospect' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"external_source" text,
	"external_id" text,
	"last_interaction_at" timestamp with time zone,
	"total_revenue_eur" numeric(14, 2),
	"health_score" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"role" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "client_activity_kind" NOT NULL,
	"title" text,
	"body" text,
	"actor_type" "client_activity_actor_type" NOT NULL,
	"actor_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"signal" "opportunity_signal" NOT NULL,
	"priority" smallint DEFAULT 50 NOT NULL,
	"title" text NOT NULL,
	"narrative" text,
	"suggested_action" jsonb,
	"status" "opportunity_status" DEFAULT 'pending' NOT NULL,
	"acted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" "opportunity_creator" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity" "custom_field_entity" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"label_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "custom_fields_key_format" CHECK ("custom_field_definitions"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "client_external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "external_source_type" NOT NULL,
	"config_encrypted" text NOT NULL,
	"status" "external_source_status" DEFAULT 'paused' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_field" text NOT NULL,
	"internal_field" text NOT NULL,
	"transform_fn" text,
	"direction" "sync_direction" DEFAULT 'pull' NOT NULL,
	"default_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"scope" "brain_scope" NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"scope" "brain_scope" DEFAULT 'org' NOT NULL,
	"title" text NOT NULL,
	"source_type" "brain_source_type" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"storage_key" text,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_opportunities" ADD CONSTRAINT "client_opportunities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_field_mappings" ADD CONSTRAINT "client_field_mappings_source_id_client_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."client_external_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_chunks" ADD CONSTRAINT "brain_chunks_document_id_brain_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."brain_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_documents" ADD CONSTRAINT "brain_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clients_org_last_interaction" ON "clients" USING btree ("org_id","last_interaction_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "clients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_clients_org_stage" ON "clients" USING btree ("org_id","lifecycle_stage") WHERE "clients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clients_external_ref" ON "clients" USING btree ("org_id","external_source","external_id") WHERE "clients"."external_source" IS NOT NULL AND "clients"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts_client" ON "client_contacts" USING btree ("client_id") WHERE "client_contacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contacts_email_unique" ON "client_contacts" USING btree ("org_id",lower("email")) WHERE "client_contacts"."deleted_at" IS NULL AND "client_contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_activities_client_time" ON "client_activities" USING btree ("client_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_activities_insight_feed" ON "client_activities" USING btree ("org_id","occurred_at" DESC NULLS LAST) WHERE "client_activities"."kind" = 'agent_insight';--> statement-breakpoint
CREATE INDEX "idx_opportunities_feed" ON "client_opportunities" USING btree ("org_id","priority" DESC NULLS LAST,"created_at" DESC NULLS LAST) WHERE "client_opportunities"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_fields_unique" ON "custom_field_definitions" USING btree ("org_id","entity","key");--> statement-breakpoint
CREATE INDEX "idx_custom_fields_org_entity" ON "custom_field_definitions" USING btree ("org_id","entity","display_order") WHERE "custom_field_definitions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_external_sources_org" ON "client_external_sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_chunks_document" ON "brain_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_chunks_org_scope" ON "brain_chunks" USING btree ("org_id","scope");--> statement-breakpoint
CREATE INDEX "idx_brain_org_scope" ON "brain_documents" USING btree ("org_id","scope");--> statement-breakpoint
CREATE INDEX "idx_brain_client" ON "brain_documents" USING btree ("client_id") WHERE "brain_documents"."client_id" IS NOT NULL;