/**
 * The e-mail that tells the college administrator a registration is waiting. The applicant's name is typed by a stranger,
 * so it must never become markup or a mail header.
 */
const mail = jest.requireActual('../../utils/email') as typeof import('../../utils/email');
import config from '../../config';

const printed = () => (console.log as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('sendNewRegistrationEmail', () => {
  it('names the applicant, the batch and the department and links to the review page', async () => {
    await mail.sendNewRegistrationEmail('office@college.edu', { fullName: 'Ada Alum', batchYear: 2015, department: 'Computer Engineering' });
    const out = printed();
    expect(out).toContain('To: office@college.edu');
    expect(out).toContain('Ada Alum');
    expect(out).toContain('2015');
    expect(out).toContain('Computer Engineering');
    expect(out).toContain(`${config.frontendUrl}/admin/approvals`);
  });

  it('escapes whatever the applicant typed', async () => {
    await mail.sendNewRegistrationEmail('office@college.edu', {
      fullName: '<script>alert(1)</script> "Evil"',
      batchYear: 2015,
      department: '<img src=x onerror=1>',
    });
    const out = printed();
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;script&gt;');
  });

  it('keeps line breaks out of the subject', async () => {
    await mail.sendNewRegistrationEmail('office@college.edu', { fullName: 'Ada\r\nBcc: attacker@evil.io', batchYear: 2015, department: 'CS' });
    const subject = printed().split('\n').find((line) => line.startsWith('Subject:')) ?? '';
    expect(subject).not.toMatch(/[\r\n]Bcc/i);
    expect(subject.length).toBeLessThan(200);
  });
});
