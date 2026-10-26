import { defineConfig } from 'drizzle-kit';

// Only used for `drizzle-kit generate` (schema diff → SQL). Migrations are applied at runtime by
// the API (`pnpm db:migrate`), against Postgres or the embedded PGlite.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['app'],
  strict: true,
  verbose: true,
});
