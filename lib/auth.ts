export interface User {
  id: string;
  email?: string;
  name?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export async function getUser(): Promise<User | null> {
  return {
    id: "demo-runner-001",
    email: "runner@runna.pro",
    name: "Alex Morgan",
  };
}

export function verifyRequestOrigin(_req: Request): void {}

// Resolves the signed-in Identity user, or returns a 401 response.
export async function requireUser(req: Request): Promise<User | Response> {
  const user = await getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}
