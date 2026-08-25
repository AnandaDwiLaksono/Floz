import { sql } from 'drizzle-orm';
import { createDatabase } from './index.js';

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, sql: client } = createDatabase(url);
  await db.execute(sql`INSERT INTO roles (code, name, description) VALUES ('ADMIN', 'Admin', 'Workspace administrator'), ('MANAGER', 'Manager', 'Workspace manager'), ('MEMBER', 'Member', 'Workspace member'), ('FIELD_WORKER', 'Field Worker', 'Field worker') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`);
  await client.end();
}

void seed();
