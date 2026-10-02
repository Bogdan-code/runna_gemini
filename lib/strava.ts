import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { stravaConnections } from "../db/schema.js";

export const STRAVA_SCOPE = "read,activity:read_all";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";

export function getStravaCredentials() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function callbackUrl(req: Request) {
  return `${new URL(req.url).origin}/api/strava/callback`;
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string; profile?: string };
};

export async function exchangeToken(params: Record<string, string>): Promise<StravaTokenResponse> {
  const creds = getStravaCredentials();
  if (!creds) throw new Error("Strava is not configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status})`);
  return res.json();
}

// Returns a valid access token for the user, refreshing it when it is about to expire.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const [conn] = await db.select().from(stravaConnections).where(eq(stravaConnections.userId, userId));
  if (!conn) return null;

  const now = Math.floor(Date.now() / 1000);
  if (conn.expiresAt > now + 120) return conn.accessToken;

  const refreshed = await exchangeToken({ grant_type: "refresh_token", refresh_token: conn.refreshToken });
  await db
    .update(stravaConnections)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: refreshed.expires_at,
    })
    .where(eq(stravaConnections.userId, userId));
  return refreshed.access_token;
}

export type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
};

export async function fetchActivities(accessToken: string, afterEpoch: number): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `${API_BASE}/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Strava activities request failed (${res.status})`);
    const batch: StravaActivity[] = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function deauthorize(accessToken: string) {
  await fetch("https://www.strava.com/oauth/deauthorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

export function redirect(location: string | URL) {
  return new Response(null, { status: 302, headers: { Location: location.toString() } });
}
