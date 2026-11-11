import { findDatabaseProblems, DEFAULT_PASSWORDS } from '../../config/databaseChecks';
import { hashPassword } from '../../utils/password';

let strongHash: string;
let adminDefaultHash: string;
let userDefaultHash: string;

beforeAll(async () => {
  strongHash = await hashPassword('Rk7!vQ2mX9pLr4TnB8cZk1Wd');
  adminDefaultHash = await hashPassword('Admin@123');
  userDefaultHash = await hashPassword('User@123');
});

const row = (overrides: Record<string, unknown>) => ({
  id: 'u1',
  email: 'someone@alumni.example.edu',
  userRole: 'MEMBER',
  isActive: true,
  passwordHash: strongHash,
  ...overrides,
});

const dbWith = (users: ReturnType<typeof row>[]) => ({
  user: { findMany: jest.fn().mockResolvedValue(users), count: jest.fn().mockResolvedValue(users.filter((u) => u.userRole === 'SUPER_ADMIN' && u.isActive).length) },
});

const codes = async (users: ReturnType<typeof row>[]) =>
  (await findDatabaseProblems(dbWith(users) as any)).map((f) => f.code);

describe('findDatabaseProblems', () => {
  it('is clean for a real super admin with a strong password and no demo accounts', async () => {
    expect(await codes([row({ userRole: 'SUPER_ADMIN', email: 'admin@alumni.example.edu' })])).toEqual([]);
  });

  it('fails when the super admin still has the seed password', async () => {
    const found = await codes([row({ userRole: 'SUPER_ADMIN', passwordHash: adminDefaultHash })]);
    expect(found).toContain('DEFAULT_CREDENTIALS');
  });

  it('fails when ANY privileged account has a known default password', async () => {
    const found = await codes([
      row({ id: 'a', userRole: 'SUPER_ADMIN' }),
      row({ id: 'b', userRole: 'CHAPTER_ADMIN', passwordHash: userDefaultHash }),
    ]);
    expect(found).toContain('DEFAULT_CREDENTIALS');
  });

  it('names the account but never prints the password or its hash', async () => {
    const findings = await findDatabaseProblems(dbWith([row({ userRole: 'SUPER_ADMIN', email: 'root@alumni.example.edu', passwordHash: adminDefaultHash })]) as any);
    const text = JSON.stringify(findings);
    expect(text).toContain('root@alumni.example.edu');
    expect(text).not.toContain('Admin@123');
    expect(text).not.toContain(adminDefaultHash);
  });

  it('fails when demo accounts from the seed exist', async () => {
    const found = await codes([row({ userRole: 'SUPER_ADMIN' }), row({ id: 'd', email: 'user1@example.com' })]);
    expect(found).toContain('DEMO_ACCOUNTS_PRESENT');
  });

  it('fails when test-suite accounts exist', async () => {
    const found = await codes([row({ userRole: 'SUPER_ADMIN' }), row({ id: 't', email: 'member.1.2@aiem.test' })]);
    expect(found).toContain('DEMO_ACCOUNTS_PRESENT');
  });

  it('flags a demo account that still has the sample password as a default credential too', async () => {
    const found = await codes([row({ userRole: 'SUPER_ADMIN' }), row({ id: 'd', email: 'user2@example.com', passwordHash: userDefaultHash })]);
    expect(found).toEqual(expect.arrayContaining(['DEMO_ACCOUNTS_PRESENT', 'DEFAULT_CREDENTIALS']));
  });

  it('fails when nobody can administer the platform', async () => {
    expect(await codes([])).toContain('NO_ACTIVE_SUPER_ADMIN');
    expect(await codes([row({ userRole: 'SUPER_ADMIN', isActive: false })])).toContain('NO_ACTIVE_SUPER_ADMIN');
  });

  it('skips accounts without a password (created earlier through a former provider sign-in) when checking passwords', async () => {
    const found = await codes([row({ userRole: 'SUPER_ADMIN', passwordHash: strongHash }), row({ id: 'o', userRole: 'ADMIN', passwordHash: null })]);
    expect(found).not.toContain('DEFAULT_CREDENTIALS');
  });

  it('every finding is an error with a fix', async () => {
    const findings = await findDatabaseProblems(dbWith([row({ userRole: 'SUPER_ADMIN', passwordHash: adminDefaultHash })]) as any);
    for (const f of findings) {
      expect(f.level).toBe('error');
      expect(f.fix.length).toBeGreaterThan(10);
    }
  });

  it('knows the passwords the seed and the test helpers use', () => {
    expect(DEFAULT_PASSWORDS).toEqual(expect.arrayContaining(['Admin@123', 'User@123']));
  });
});
