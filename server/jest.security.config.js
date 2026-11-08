/** @type {import('jest').Config} */
// Authorization/security exploit suite against a real PostgreSQL 17 instance (embedded, no
// Docker). Reuses the integration suite's embedded-Postgres bootstrap (globalSetup/globalTeardown)
// so these tests run the same way: `npx jest -c jest.security.config.js --runInBand --maxWorkers=1`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/security'],
  testMatch: ['**/*.sec.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  setupFiles: ['<rootDir>/tests/env.ts', '<rootDir>/tests/integration/env.ts'],
  globalSetup: '<rootDir>/tests/integration/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/integration/globalTeardown.ts',
  maxWorkers: 1,
  testTimeout: 60000,
};
