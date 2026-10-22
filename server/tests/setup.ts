/**
 * Unit-test harness.
 *
 * Every test gets a fresh deep mock of the Prisma client so services,
 * controllers and full HTTP routes can be exercised without a database.
 * Use `prismaMock` from tests/helpers to arrange data per test.
 */
import { mockReset } from 'jest-mock-extended';

jest.mock('../src/config/database', () => {
  const { mockDeep: deep } = jest.requireActual('jest-mock-extended');
  const client = deep();
  return { __esModule: true, default: client, prisma: client };
});

// Outbound e-mail is never sent from unit tests
jest.mock('../src/utils/email', () => {
  const actual = jest.requireActual('../src/utils/email');
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = typeof actual[key] === 'function' ? jest.fn().mockResolvedValue(undefined) : actual[key];
  }
  return { __esModule: true, ...mocked };
});

// Typed loosely on purpose: DeepMockProxy<PrismaClient> trips TS2615 on Prisma's groupBy types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaMock: any = jest.requireMock('../src/config/database').default;

const wireTransactions = () => {
  // Default: run interactive transactions against the same mock, and
  // resolve array transactions in order.
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg)
  );
};

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

beforeEach(() => {
  mockReset(prismaMock);
  wireTransactions();
});

afterAll(() => {
  jest.restoreAllMocks();
});

export { prismaMock };
