import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { db } from "../../db/index.js";
import { profiles, stravaConnections } from "../../db/schema.js";
import { exchangeToken, redirect } from "../../lib/strava.js";

// Strava redirects here after the athlete approves (or denies) access.
export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const back = (status: string) => redirect(new URL(`/?strava=${status}`, req.url));

  const expectedState = context.cookies.get("strava_oauth_state");
  context.cookies.delete({ name: "strava_oauth_state", path: "/api/strava" });

  const user = await getUser();
  if (!user) return back("auth_required");
  if (url.searchParams.get("error")) return back("denied");

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!code || !state || state !== expectedState) return back("invalid_state");

  const scope = url.searchParams.get("scope") ?? "";
  if (!scope.includes("activity:read")) return back("missing_scope");

  try {
    const token = await exchangeToken({ code, grant_type: "authorization_code" });
    const athlete = token.athlete;
    if (!athlete) return back("error");

    await db
      .insert(profiles)
      .values({ userId: user.id, email: user.email ?? "", displayName: user.name || user.email?.split("@")[0] || "Runner" })
      .onConflictDoNothing();

    const values = {
      userId: user.id,
      athleteId: athlete.id,
      athleteName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" "),
      athleteAvatar: athlete.profile ?? null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      scope,
    };
    await db
      .insert(stravaConnections)
      .values(values)
      .onConflictDoUpdate({ target: stravaConnections.userId, set: { ...values, connectedAt: new Date() } });
  } catch (err) {
    console.error("Strava token exchange failed:", err);
    return back("error");
  }

  return back("connected");
};

export const config: Config = {
  path: "/api/strava/callback",
  method: "GET",
};
