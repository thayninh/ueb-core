import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Client generation and schema validation do not require database access.
    // Migration commands must never reuse the Next.js runtime credential.
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
});
