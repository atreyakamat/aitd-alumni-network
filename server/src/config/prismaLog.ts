/**
 * Which events the Prisma client prints.
 *
 * Production and tests: errors only. Query text can contain personal data and drowns the
 * structured request log. Development: warnings and errors; the SQL itself is opt-in
 * (`PRISMA_LOG_QUERIES=true`) because it hides everything else the API prints.
 */
export type PrismaLogLevel = 'query' | 'warn' | 'error';

export const prismaLogLevels = (env: NodeJS.ProcessEnv = process.env): PrismaLogLevel[] => {
  if (env.NODE_ENV !== 'development') return ['error'];
  return env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'];
};
