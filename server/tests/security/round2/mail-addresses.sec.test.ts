/**
 * ROUND 2 - every address that can reach nodemailer's `to:` must be one single, plain mailbox. nodemailer splits on
 * commas/semicolons, reads "Name <addr>" and comments, and accepts quoted local parts - so a loosely validated address
 * becomes extra recipients or a different recipient than the one that was checked.
 */
import nodemailer from 'nodemailer/lib/addressparser';
import { http, prisma, uniqueEmail, createUser } from '../../integration/helpers';
import { normalizeEmail } from '../../../src/services/inviteService';

afterAll(async () => {
  await prisma.$disconnect();
});

const HOSTILE = [
  'a@b.com, c@d.com',
  'a@b.com,c@d.com',
  'a@b.com;c@d.com',
  'a@b.com\r\nBcc: x@y.com',
  'a@b.com\nBcc: x@y.com',
  'a@b.com%0d%0aBcc:x@y.com',
  '"a@b.com, c"@d.com',
  '<a@b.com>',
  'Name <a@b.com>',
  'a@b.com (comment)',
  'a(comment)@b.com',
  'a@b.com,c.d',
  'x,y@b.com',
  'a@b.com>,<evil.d',
  'Victim<v@x.com>.a',
  'a@[127.0.0.1]',
  'a@b',
  '@b.com',
  'a@@b.com',
];

describe('single plain mailbox only', () => {
  it.each(HOSTILE)('registration refuses %j', async (email) => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password: 'Str0ng!Passw0rd', fullName: 'Mail Tester', batchYear: 2015, department: 'Computer Engineering', degree: 'B.E.' });
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { fullName: 'Mail Tester', email: { contains: 'b.com' } } })).toBe(0);
  });

  it.each(HOSTILE)('the invitation validator refuses %j', (email) => {
    expect(normalizeEmail(email)).toBeNull();
  });

  it.each(HOSTILE)('guest donation orders refuse %j as donor e-mail', async (donorEmail) => {
    const res = await http().post('/api/donations/order').send({ amount: 500, donorName: 'Guest', donorEmail });
    expect([400, 503]).toContain(res.status); // 503 only when the gateway is not configured, and only AFTER validation
    if (res.status === 503) {
      // validation happens before the gateway is contacted: a refusal would be a 400
      const pending = await prisma.transaction.count({ where: { type: 'DONATION', metadata: { path: ['donorEmail'], equals: donorEmail } } });
      expect(pending).toBe(0);
    }
  });

  it('every accepted invitation address is exactly one mailbox in the eyes of nodemailer', async () => {
    const inviter = await createUser('MEMBER');
    const stamp = Date.now();
    for (const email of [`plain.${stamp}@aiem.test`, `o'brien+tag.${stamp}@mail.example.co.in`, `UPPER.${stamp}@Example.ORG`]) {
      const normalised = normalizeEmail(email);
      expect(normalised).not.toBeNull();
      const parsed = nodemailer(normalised!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].address).toBe(normalised);
    }
    const ok = await http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email: uniqueEmail('Invitee') });
    expect(ok.status).toBe(201);
  });
});
