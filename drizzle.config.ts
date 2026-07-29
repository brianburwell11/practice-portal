import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    // Only needed for `db:migrate` / `db:studio`; `db:generate` is offline.
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
