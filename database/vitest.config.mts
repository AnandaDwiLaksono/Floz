import { defineConfig } from 'vitest/config';
import { assertQaDatabase } from '../apps/web/e2e-environment';

// Fail before collecting tests: even teardown must never reach an unproven database.
assertQaDatabase();

export default defineConfig({});
