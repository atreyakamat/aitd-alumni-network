/**
 * Where the member's notification settings are honoured: the bell row (createNotification and the Kafka consumer), the
 * broadcast fan-out and the e-mail paths. A suppressed notification is a successful no-op: nothing stored, nothing
 * thrown, nothing to retry or dead-letter.
 */
import { notificationService } from '../../services/notificationService';
import { handleNotificationEvent } from '../../services/notificationEventHandlers';
import { buildEnvelope } from '../../services/notificationEvents';
import { fanOutNotification } from '../../services/broadcastService';
import { digestService } from '../../services/digestService';
import { emitToUser } from '../../utils/socket';
import { sendNewRegistrationEmail, sendApplicationReceivedEmail, sendWelcomeEmail, sendRejectionEmail } from '../../utils/email';
import { prismaMock } from '../../../tests/helpers';

jest.mock('../../utils/socket', () => ({ emitToUser: jest.fn() }));

const ME = 'user-1';
const note = { userId: ME, type: 'POST_LIKED' as const, title: 'Liked', message: 'Ada liked your post', link: '/posts/1' };

const optedOut = (inApp: boolean, email = true) => prismaMock.notificationPreference.findUnique.mockResolvedValue({ inApp, email });

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
  prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({ id: 'n1', ...note });
});

describe('createNotification and the bell', () => {
  it('stores the notification when the member never changed a setting', async () => {
    await expect(notificationService.createNotification(note)).resolves.toMatchObject({ id: 'n1' });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it('is a quiet no-op when the member switched the bell off for that category', async () => {
    optedOut(false);
    await expect(notificationService.createNotification(note)).resolves.toBeUndefined();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('looks at the right member and category', async () => {
    await notificationService.createNotification(note);
    expect(prismaMock.notificationPreference.findUnique.mock.calls[0][0].where).toEqual({ userId_category: { userId: ME, category: 'POSTS_AND_COMMENTS' } });
  });

  it('switching only the e-mail off leaves the bell on', async () => {
    optedOut(true, false);
    await expect(notificationService.createNotification(note)).resolves.toMatchObject({ id: 'n1' });
  });

  it.each(['REGISTRATION_PENDING', 'MEMBERSHIP_EXPIRY', 'CONTENT_REPORTED'] as const)('%s is delivered whatever the settings say', async (type) => {
    optedOut(false, false);
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: ME, inApp: false, email: false }]);
    await expect(notificationService.createNotification({ ...note, type })).resolves.toMatchObject({ id: 'n1' });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
  });

  it('an essential notice (for example a payment problem reported to an administrator) is delivered even though its type is switchable', async () => {
    optedOut(false, false);
    await notificationService.createNotification({ ...note, type: 'ADMIN_ANNOUNCEMENT', essential: true });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });

  it('the essential flag is not stored on the notification', async () => {
    await notificationService.createNotification({ ...note, type: 'ADMIN_ANNOUNCEMENT', essential: true });
    expect(JSON.stringify(prismaMock.notification.create.mock.calls[0][0])).not.toContain('essential');
  });

  it('delivers when the settings cannot be read', async () => {
    prismaMock.notificationPreference.findUnique.mockRejectedValue(new Error('db down'));
    await expect(notificationService.createNotification(note)).resolves.toMatchObject({ id: 'n1' });
  });
});

describe('the Kafka consumer', () => {
  const deliver = () => buildEnvelope('notification.deliver', note);

  it('a suppressed event resolves (so it is acknowledged), is not retried and creates nothing', async () => {
    optedOut(false);
    await expect(handleNotificationEvent(deliver(), { redelivery: true })).resolves.toBeUndefined();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('is idempotent: a redelivered event that was stored before the member opted out is still stored once', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n-existing' });
    await handleNotificationEvent(deliver(), { redelivery: true });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('still stores (with the event id) when the member has not opted out', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const ev = deliver();
    await handleNotificationEvent(ev, { redelivery: true });
    expect(prismaMock.notification.create.mock.calls[0][0].data.metadata).toEqual({ eventId: ev.id });
  });

  it('an event from the topic cannot switch the bypass on by itself unless the event says essential', async () => {
    optedOut(false);
    await handleNotificationEvent(buildEnvelope('notification.deliver', { ...note, type: 'ADMIN_ANNOUNCEMENT' }), { redelivery: true });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    await handleNotificationEvent(buildEnvelope('notification.deliver', { ...note, type: 'ADMIN_ANNOUNCEMENT', essential: true }), { redelivery: true });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe('broadcast fan-out', () => {
  const payload = { type: 'ADMIN_ANNOUNCEMENT' as const, title: 'Reunion', message: 'Join us', link: '/events/1' };

  it('skips the members who switched announcements off, and does not nudge them', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: 'b' }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 2 });

    const delivered = await fanOutNotification(payload);

    expect(delivered).toBe(2);
    expect(prismaMock.notification.createMany.mock.calls[0][0].data.map((row: { userId: string }) => row.userId)).toEqual(['a', 'c']);
    expect(prismaMock.notificationPreference.findMany.mock.calls[0][0].where).toMatchObject({ category: 'ANNOUNCEMENTS', inApp: false });
    expect((emitToUser as jest.Mock).mock.calls.map((call) => call[0])).toEqual(['a', 'c']);
  });

  it('still pages through every member when a whole batch opted out', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }]);
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: 'a' }]);
    await expect(fanOutNotification(payload)).resolves.toBe(0);
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('a notice that must always be delivered reaches everybody and the settings are not even read', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 2 });
    await expect(fanOutNotification({ ...payload, type: 'MEMBERSHIP_EXPIRY' })).resolves.toBe(2);
    expect(prismaMock.notificationPreference.findMany).not.toHaveBeenCalled();
  });
});

describe('the e-mails', () => {
  beforeEach(() => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({ inApp: false, email: false });
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: 'adm1', inApp: false, email: false }]);
    prismaMock.user.findUnique.mockResolvedValue({ id: ME, email: 'ada@example.com', fullName: 'Ada' });
  });

  it('the registration e-mails are sent whatever the settings say', async () => {
    await handleNotificationEvent(buildEnvelope('registration.received', { userId: ME }));
    await handleNotificationEvent(buildEnvelope('registration.approved', { userId: ME }));
    await handleNotificationEvent(buildEnvelope('registration.rejected', { userId: ME, reason: 'Not on the list' }));
    expect(sendApplicationReceivedEmail).toHaveBeenCalledWith('ada@example.com', 'Ada');
    expect(sendWelcomeEmail).toHaveBeenCalledWith('ada@example.com', 'Ada');
    expect(sendRejectionEmail).toHaveBeenCalledWith('ada@example.com', 'Ada', 'Not on the list');
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
  });

  it('the administrator is told about a waiting registration, in the app and by e-mail, even with every setting off', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'app1', fullName: 'Ada Alum', batchYear: 2015, department: 'CE', approvalStatus: 'PENDING' });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'adm1', email: 'dean@college.edu' }]);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    await handleNotificationEvent(buildEnvelope('registration.submitted', { applicantId: 'app1' }));
    expect(sendNewRegistrationEmail).toHaveBeenCalledWith('dean@college.edu', expect.any(Object));
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });

  it('the weekly digest (the announcements e-mail) leaves out the members who switched that e-mail off', async () => {
    prismaMock.digestSettings.findUnique.mockResolvedValue(null);
    prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1', title: 'SWE', company: 'Acme' }]);
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.collegeVideo.findMany.mockResolvedValue([]);
    prismaMock.collegeRequirement.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);

    await digestService.sendDigest();

    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      isVerified: true,
      digestOptOut: false,
      notificationPreferences: { none: { category: 'ANNOUNCEMENTS', email: false } },
    });
  });
});
