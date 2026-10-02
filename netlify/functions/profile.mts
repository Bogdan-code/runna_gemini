import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { profiles } from "../../db/schema.js";
import { requireUser } from "../../lib/auth.js";

const EDITABLE_FIELDS = [
  "displayName",
  "onboarded",
  "units",
  "baseline5kSeconds",
  "goalDistance",
  "goalAmbition",
  "experience",
  "frequencyDays",
  "preferredDays",
  "planWeeks",
  "targetDate",
  "completedWorkouts",
  "plan",
] as const;

function serialize(row: typeof profiles.$inferSelect) {
  const { userId, createdAt, updatedAt, ...rest } = row;
  return { uid: userId, ...rest };
}

export default async (req: Request) => {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  if (req.method === "GET") {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, user.id));
    return Response.json({ profile: row ? serialize(row) : null });
  }

  if (req.method === "PUT") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key in body) updates[key] = body[key];
    }

    const fallbackName = (user.name as string | undefined) || user.email?.split("@")[0] || "Runner";
    const [row] = await db
      .insert(profiles)
      .values({
        userId: user.id,
        email: user.email ?? "",
        displayName: fallbackName,
        ...updates,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { ...updates, email: user.email ?? "", updatedAt: new Date() },
      })
      .returning();

    return Response.json({ profile: serialize(row) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/profile",
  method: ["GET", "PUT"],
};
