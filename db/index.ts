import * as schema from "./schema.js";

let db: any;
try {
  const { drizzle } = await import("drizzle-orm/netlify-db");
  db = drizzle({ schema });
} catch {
  console.warn('[AI Studio] Database not connected — using mock');
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
  };
  db = new Proxy({}, {
    get: (_, prop) => prop === 'query'
      ? new Proxy({}, { get: () => noOp })
      : () => ({
          from: () => ({
            where: () => [],
            values: () => ({
              onConflictDoUpdate: () => ({ returning: () => [] }),
              onConflictDoNothing: () => [],
            }),
          }),
          select: () => ({
            from: () => ({
              where: () => [],
            }),
          }),
          insert: () => ({
            values: () => ({
              onConflictDoUpdate: () => ({ returning: () => [] }),
              onConflictDoNothing: () => [],
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => [],
            }),
          }),
        }),
  });
}
export { db };
