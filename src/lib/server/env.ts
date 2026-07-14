import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required." })
    .min(1, "DATABASE_URL is required.")
    .refine(isPostgresUrl, "DATABASE_URL must be a valid PostgreSQL URL."),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

export function getServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Server environment validation failed: ${issues}`);
  }

  return result.data;
}
