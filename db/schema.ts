import { pgTable, text, timestamp, integer, boolean, jsonb, bigint, real, index } from "drizzle-orm/pg-core";

// One row per Netlify Identity user. Holds the onboarding answers and the generated plan.
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text().notNull(),
  displayName: text("display_name").notNull().default(""),
  onboarded: boolean().notNull().default(false),
  units: text().notNull().default("km"),
  baseline5kSeconds: integer("baseline_5k_seconds").notNull().default(1590),
  goalDistance: text("goal_distance").notNull().default("10k"),
  goalAmbition: text("goal_ambition").notNull().default("finish"),
  experience: text().notNull().default("intermediate"),
  frequencyDays: integer("frequency_days").notNull().default(4),
  preferredDays: jsonb("preferred_days").$type<string[]>().notNull().default(["Tue", "Thu", "Sat", "Sun"]),
  planWeeks: integer("plan_weeks").notNull().default(12),
  targetDate: text("target_date"),
  completedWorkouts: jsonb("completed_workouts").$type<Record<string, unknown>>().notNull().default({}),
  plan: jsonb().$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// OAuth tokens for a user's linked Strava account.
export const stravaConnections = pgTable("strava_connections", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  athleteId: bigint("athlete_id", { mode: "number" }).notNull(),
  athleteName: text("athlete_name").notNull().default(""),
  athleteAvatar: text("athlete_avatar"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  scope: text().notNull().default(""),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

// Runs imported from Strava.
export const stravaActivities = pgTable(
  "strava_activities",
  {
    id: bigint({ mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
    name: text().notNull().default(""),
    sportType: text("sport_type").notNull().default("Run"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    startDateLocal: text("start_date_local").notNull(),
    distanceMeters: real("distance_meters").notNull().default(0),
    movingTimeSeconds: integer("moving_time_seconds").notNull().default(0),
    elapsedTimeSeconds: integer("elapsed_time_seconds").notNull().default(0),
    elevationGainMeters: real("elevation_gain_meters").notNull().default(0),
    averageSpeed: real("average_speed").notNull().default(0),
    averageHeartrate: real("average_heartrate"),
    maxHeartrate: real("max_heartrate"),
  },
  (t) => [index("strava_activities_user_start_idx").on(t.userId, t.startDate)]
);
