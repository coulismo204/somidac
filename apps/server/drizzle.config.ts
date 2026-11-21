import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/noyau/base/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.SOMIDAC_DATABASE_URL ?? 'postgres://somidac:somidac_dev@127.0.0.1:5433/somidac',
  },
});
