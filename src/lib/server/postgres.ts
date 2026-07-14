import { Pool } from "pg";

import { getServerEnv } from "@/lib/server/env";

type GlobalPostgres = typeof globalThis & {
  uebCorePostgresPool?: Pool;
};

const globalPostgres = globalThis as GlobalPostgres;

let postgresPool: Pool | undefined;

function createPostgresPool(): Pool {
  const { DATABASE_URL } = getServerEnv();

  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    application_name: "ueb-core",
  });

  pool.on("error", () => {
    console.error("Unexpected PostgreSQL pool error.");
  });

  return pool;
}

export function getPostgresPool(): Pool {
  if (process.env.NODE_ENV === "development") {
    globalPostgres.uebCorePostgresPool ??= createPostgresPool();

    return globalPostgres.uebCorePostgresPool;
  }

  postgresPool ??= createPostgresPool();

  return postgresPool;
}
