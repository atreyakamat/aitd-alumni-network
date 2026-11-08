/** @type {import('jest').Config} */
// Client/server contract suite against a real PostgreSQL 17 instance (embedded, no Docker): every HTTP call
// the Next.js client makes must hit a real route that accepts the fields it sends, and every route must
// answer a realistic valid request without a 5xx and a minimal invalid one with a 4xx.
// Same bootstrap as the integration suite: `npm run test:contract` (== jest -c jest.contract.config.js --runInBand).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/contract'],
  testMatch: ['**/*.contract.test.ts'],
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
