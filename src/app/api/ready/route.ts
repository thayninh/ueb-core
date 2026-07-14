import { getPostgresPool } from "@/lib/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(): Promise<Response> {
  try {
    await getPostgresPool().query("SELECT 1");

    return Response.json(
      {
        status: "ready",
        service: "ueb-core",
        database: "reachable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: noStoreHeaders,
      },
    );
  } catch {
    console.error("Database readiness check failed.");

    return Response.json(
      {
        status: "not_ready",
        service: "ueb-core",
        database: "unreachable",
      },
      {
        status: 503,
        headers: noStoreHeaders,
      },
    );
  }
}
