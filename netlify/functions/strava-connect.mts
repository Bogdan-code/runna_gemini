import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { callbackUrl, getStravaCredentials, redirect, STRAVA_SCOPE } from "../../lib/strava.js";

// Starts the Strava OAuth flow for the signed-in user.
export default async (req: Request, context: Context) => {
  const user = await getUser();
  if (!user) return redirect(new URL("/", req.url));

  const creds = getStravaCredentials();
  if (!creds) return redirect(new URL("/?strava=not_configured", req.url));

  const state = crypto.randomUUID();
  context.cookies.set({
    name: "strava_oauth_state",
    value: state,
    path: "/api/strava",
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "Lax",
    expires: new Date(Date.now() + 10 * 60 * 1000),
  });

  const authorize = new URL("https://www.strava.com/oauth/authorize");
  authorize.searchParams.set("client_id", creds.clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl(req));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("approval_prompt", "auto");
  authorize.searchParams.set("scope", STRAVA_SCOPE);
  authorize.searchParams.set("state", state);

  return redirect(authorize.toString());
};

export const config: Config = {
  path: "/api/strava/connect",
  method: "GET",
};
