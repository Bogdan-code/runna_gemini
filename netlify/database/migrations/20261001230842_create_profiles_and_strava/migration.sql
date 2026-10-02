CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"units" text DEFAULT 'km' NOT NULL,
	"baseline_5k_seconds" integer DEFAULT 1590 NOT NULL,
	"goal_distance" text DEFAULT '10k' NOT NULL,
	"goal_ambition" text DEFAULT 'finish' NOT NULL,
	"experience" text DEFAULT 'intermediate' NOT NULL,
	"frequency_days" integer DEFAULT 4 NOT NULL,
	"preferred_days" jsonb DEFAULT '["Tue","Thu","Sat","Sun"]' NOT NULL,
	"plan_weeks" integer DEFAULT 12 NOT NULL,
	"target_date" text,
	"completed_workouts" jsonb DEFAULT '{}' NOT NULL,
	"plan" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_activities" (
	"id" bigint PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"sport_type" text DEFAULT 'Run' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"start_date_local" text NOT NULL,
	"distance_meters" real DEFAULT 0 NOT NULL,
	"moving_time_seconds" integer DEFAULT 0 NOT NULL,
	"elapsed_time_seconds" integer DEFAULT 0 NOT NULL,
	"elevation_gain_meters" real DEFAULT 0 NOT NULL,
	"average_speed" real DEFAULT 0 NOT NULL,
	"average_heartrate" real,
	"max_heartrate" real
);
--> statement-breakpoint
CREATE TABLE "strava_connections" (
	"user_id" text PRIMARY KEY,
	"athlete_id" bigint NOT NULL,
	"athlete_name" text DEFAULT '' NOT NULL,
	"athlete_avatar" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" integer NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "strava_activities_user_start_idx" ON "strava_activities" ("user_id","start_date");--> statement-breakpoint
ALTER TABLE "strava_activities" ADD CONSTRAINT "strava_activities_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "strava_connections" ADD CONSTRAINT "strava_connections_user_id_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE CASCADE;