import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDatabase, accounts, sessions, users, verifications } from '@floz/database';
import { normalizeOrigins, type NodeEnv } from '@floz/config';

@Injectable()
export class AuthService implements OnModuleDestroy {
  readonly database;
  readonly auth;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    this.database = createDatabase(url, { owner: 'api', max: 2 });
    this.auth = betterAuth({
      database: drizzleAdapter(this.database.db, {
        provider: 'pg',
        schema: { user: users, account: accounts, session: sessions, verification: verifications }
      }),
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
      trustedOrigins: normalizeOrigins(process.env, (process.env.NODE_ENV ?? 'development') as NodeEnv),
      emailAndPassword: { enabled: true, autoSignIn: false },
      user: { modelName: 'user' },
      session: { modelName: 'session' },
      account: { modelName: 'account' },
      verification: { modelName: 'verification' },
      advanced: {
        database: { generateId: 'uuid' },
        cookies: {
          session_token: { name: 'floz_session', attributes: { httpOnly: true, sameSite: 'lax', path: '/api/v1', secure: process.env.NODE_ENV === 'production' } }
        }
      }
    });
  }

  async onModuleDestroy() {
    await this.database.sql.end();
  }
}
