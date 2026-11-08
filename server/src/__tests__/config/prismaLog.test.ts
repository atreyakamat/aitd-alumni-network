import { prismaLogLevels } from '../../config/prismaLog';

describe('prismaLogLevels', () => {
  it('logs only errors in production (query text can contain personal data)', () => {
    expect(prismaLogLevels({ NODE_ENV: 'production' })).toEqual(['error']);
  });

  it('logs only errors in production even when someone asks for queries', () => {
    expect(prismaLogLevels({ NODE_ENV: 'production', PRISMA_LOG_QUERIES: 'true' })).toEqual(['error']);
  });

  it('keeps development output readable by default: warnings and errors, no SQL', () => {
    expect(prismaLogLevels({ NODE_ENV: 'development' })).toEqual(['warn', 'error']);
  });

  it('prints the SQL in development when explicitly asked', () => {
    expect(prismaLogLevels({ NODE_ENV: 'development', PRISMA_LOG_QUERIES: 'true' })).toEqual(['query', 'warn', 'error']);
  });

  it('treats anything but "true" as off', () => {
    expect(prismaLogLevels({ NODE_ENV: 'development', PRISMA_LOG_QUERIES: '1' })).toEqual(['warn', 'error']);
    expect(prismaLogLevels({ NODE_ENV: 'development', PRISMA_LOG_QUERIES: '' })).toEqual(['warn', 'error']);
  });

  it('is quiet under the test runner', () => {
    expect(prismaLogLevels({ NODE_ENV: 'test' })).toEqual(['error']);
  });
});
