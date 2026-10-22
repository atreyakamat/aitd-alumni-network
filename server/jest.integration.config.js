/** @type {import('jest').Config} */
// Integration tests against a real PostgreSQL 17 instance (embedded, no Docker).
// Set TEST_DATABASE_URL to use an existing server instead.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.int.test.ts'],
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
