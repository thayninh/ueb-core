import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/server";
import { recordLoginFailure } from "@/lib/auth/audit-writer";
import { guardBetterAuthRequest } from "@/lib/auth/password-change-route-guard";

const handlers = toNextJsHandler((request) => getAuth().handler(request));

export async function GET(request: Request): Promise<Response> {
  return (await guardBetterAuthRequest(request)) ?? handlers.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await guardBetterAuthRequest(request);
  if (blocked) return blocked;
  if (!new URL(request.url).pathname.endsWith("/sign-in/email")) {
    return handlers.POST(request);
  }

  const email = await readEmailOnly(request.clone());
  try {
    const response = await handlers.POST(request);
    if (!response.ok) await recordLoginFailure(email);
    return response;
  } catch (error) {
    await recordLoginFailure(email);
    throw error;
  }
}

async function readEmailOnly(request: Request): Promise<string | null> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || !("email" in body)) return null;
      const email = (body as { email?: unknown }).email;
      return typeof email === "string" ? email.trim().toLowerCase() : null;
    }
    const email = (await request.formData()).get("email");
    return typeof email === "string" ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
