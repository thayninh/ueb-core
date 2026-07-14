export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      service: "ueb-core",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: noStoreHeaders,
    },
  );
}
