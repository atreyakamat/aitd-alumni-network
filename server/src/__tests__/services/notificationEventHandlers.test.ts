import { handleNotificationEvent } from '../../services/notificationEventHandlers';
import { buildEnvelope } from '../../services/notificationEvents';
import { prismaMock } from '../../../tests/helpers';
import { emitToUser } from '../../utils/socket';
import { fanOutNotification } from '../../services/broadcastService';
import { sendNewRegistrationEmail, sendApplicationReceivedEmail, sendWelcomeEmail, sendRejectionEmail } from '../../utils/email';

jest.mock('../../utils/socket', () => ({ emitToUser: jest.fn() }));
jest.mock('../../services/broadcastService', () => ({ fanOutNotification: jest.fn().mockResolvedValue(42) }));

const envelope = (type: any, data: any) => buildEnvelope(type, data);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.APPROVAL_NOTIFY_EMAIL;
});

describe('notification.deliver', () => {
  const data = { userId: 'u1', type: 'POST_LIKED', title: 'Liked', message: 'Ada liked your post', link: '/posts/1', metadata: { postId: 'p1' } };

  it('stores the notification exactly as given, nudges the member in real time and returns it', async () => {
    prismaMock.notification.create.mockResolvedValue({ id: 'n1', ...data });
    const result = await handleNotificationEvent(envelope('notification.deliver', data));
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: { userId: 'u1', type: 'POST_LIKED', title: 'Liked', message: 'Ada liked your post', link: '/posts/1', metadata: { postId: 'p1' } },
    });
    expect(emitToUser).toHaveBeenCalledWith('u1', 'new_notification', expect.objectContaining({ id: 'n1' }));
    expect(result).toMatchObject({ id: 'n1' });
  });

  it('a socket failure does not undo the stored notification', async () => {
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
    (emitToUser as jest.Mock).mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    await expect(handleNotificationEvent(envelope('notification.deliver', data))).resolves.toMatchObject({ id: 'n1' });
  });

  it('a redelivered event (Kafka is at-least-once) is stored once: the event id marks the notification', async () => {
    const ev = envelope('notification.deliver', data);
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n-existing' });
    await handleNotificationEvent(ev, { redelivery: true });
    expect(prismaMock.notification.findFirst.mock.calls[0][0].where).toMatchObject({ userId: 'u1', metadata: { path: ['eventId'], equals: ev.id } });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('the first delivery of an event from Kafka carries the event id in the metadata', async () => {
    const ev = envelope('notification.deliver', data);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
    await handleNotificationEvent(ev, { redelivery: true });
    expect(prismaMock.notification.create.mock.calls[0][0].data.metadata).toEqual({ postId: 'p1', eventId: ev.id });
  });

  it('does not look for duplicates or touch the metadata when handled in-process', async () => {
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
    await handleNotificationEvent(envelope('notification.deliver', data));
    expect(prismaMock.notification.findFirst).not.toHaveBeenCalled();
  });
});

describe('notification.broadcast', () => {
  const payload = { type: 'ADMIN_ANNOUNCEMENT', title: 'Reunion', message: 'Join us', link: '/events/1' };

  it('fans out to every active member', async () => {
    await expect(handleNotificationEvent(envelope('notification.broadcast', payload))).resolves.toBe(42);
    expect(fanOutNotification).toHaveBeenCalledWith(expect.objectContaining(payload));
  });

  it('a redelivered broadcast is not sent to everybody twice', async () => {
    const ev = envelope('notification.broadcast', payload);
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n-existing' });
    await handleNotificationEvent(ev, { redelivery: true });
    expect(prismaMock.notification.findFirst.mock.calls[0][0].where).toMatchObject({ metadata: { path: ['broadcastId'], equals: ev.id } });
    expect(fanOutNotification).not.toHaveBeenCalled();
  });

  it('marks a broadcast that came through Kafka with the event id', async () => {
    const ev = envelope('notification.broadcast', payload);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    await handleNotificationEvent(ev, { redelivery: true });
    expect((fanOutNotification as jest.Mock).mock.calls[0][0].metadata).toEqual({ broadcastId: ev.id });
  });
});

describe('registration.submitted: the college administrator is told', () => {
  const applicant = { id: 'app1', fullName: 'Ada Alum', batchYear: 2015, department: 'Computer Engineering', approvalStatus: 'PENDING' };
  const admins = [
    { id: 'adm1', email: 'dean@college.edu', fullName: 'Dean' },
    { id: 'adm2', email: 'office@college.edu', fullName: 'Office' },
  ];
  const submitted = () => envelope('registration.submitted', { applicantId: 'app1' });

  const arrange = (opts: { applicant?: any; admins?: any[]; existing?: Record<string, boolean> } = {}) => {
    prismaMock.user.findUnique.mockResolvedValue(opts.applicant === undefined ? applicant : opts.applicant);
    prismaMock.user.findMany.mockResolvedValue(opts.admins ?? admins);
    prismaMock.notification.findFirst.mockImplementation(((args: any) =>
      Promise.resolve(opts.existing?.[args.where.userId] ? { id: 'n-old' } : null)) as any);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' });
  };

  it('notifies every active, approved administrator in the app and by e-mail', async () => {
    arrange();
    await handleNotificationEvent(submitted());

    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isActive: true, approvalStatus: 'APPROVED', userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({
      userId: 'adm1',
      type: 'REGISTRATION_PENDING',
      link: '/admin/approvals',
      metadata: { applicantId: 'app1' },
    });
    expect(prismaMock.notification.create.mock.calls[0][0].data.message).toContain('Ada Alum');
    expect(sendNewRegistrationEmail).toHaveBeenCalledWith('dean@college.edu', { fullName: 'Ada Alum', batchYear: 2015, department: 'Computer Engineering' });
    expect(sendNewRegistrationEmail).toHaveBeenCalledWith('office@college.edu', expect.any(Object));
    expect(emitToUser).toHaveBeenCalledTimes(2);
  });

  it('also writes to the college office mailbox when APPROVAL_NOTIFY_EMAIL is set (several addresses allowed, bad ones ignored, no repeats)', async () => {
    process.env.APPROVAL_NOTIFY_EMAIL = 'alumni-office@college.edu, not-an-address , Office@College.edu, alumni-office@college.edu';
    arrange();
    await handleNotificationEvent(submitted());
    const recipients = (sendNewRegistrationEmail as jest.Mock).mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['alumni-office@college.edu', 'dean@college.edu', 'office@college.edu']);
  });

  it('works with only the shared mailbox when there is no administrator account yet', async () => {
    process.env.APPROVAL_NOTIFY_EMAIL = 'alumni-office@college.edu';
    arrange({ admins: [] });
    await handleNotificationEvent(submitted());
    expect(sendNewRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('sends the e-mail before the in-app notice is recorded, so a failed mail is retried and not lost', async () => {
    arrange();
    (sendNewRegistrationEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(handleNotificationEvent(submitted())).rejects.toThrow('smtp down');
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('on a retry, an administrator who already has the notice is not told twice', async () => {
    arrange({ existing: { adm1: true } });
    await handleNotificationEvent(submitted());
    expect(sendNewRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(sendNewRegistrationEmail).toHaveBeenCalledWith('office@college.edu', expect.any(Object));
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an applicant who is gone or already decided', async () => {
    arrange({ applicant: null });
    await handleNotificationEvent(submitted());
    arrange({ applicant: { ...applicant, approvalStatus: 'APPROVED' } });
    await handleNotificationEvent(submitted());
    expect(sendNewRegistrationEmail).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('puts no more than a bounded number of administrators in one run', async () => {
    arrange();
    await handleNotificationEvent(submitted());
    expect(prismaMock.user.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(200);
  });
});

describe('e-mails to the applicant', () => {
  const user = { id: 'u1', email: 'ada@aitd.edu', fullName: 'Ada Alum' };
  beforeEach(() => prismaMock.user.findUnique.mockResolvedValue(user));

  it('registration.received: "we received your registration"', async () => {
    await handleNotificationEvent(envelope('registration.received', { userId: 'u1' }));
    expect(sendApplicationReceivedEmail).toHaveBeenCalledWith('ada@aitd.edu', 'Ada Alum');
  });

  it('registration.approved: "you can sign in"', async () => {
    await handleNotificationEvent(envelope('registration.approved', { userId: 'u1' }));
    expect(sendWelcomeEmail).toHaveBeenCalledWith('ada@aitd.edu', 'Ada Alum');
  });

  it('registration.rejected: the reason the administrator gave', async () => {
    await handleNotificationEvent(envelope('registration.rejected', { userId: 'u1', reason: 'Not on our rolls' }));
    expect(sendRejectionEmail).toHaveBeenCalledWith('ada@aitd.edu', 'Ada Alum', 'Not on our rolls');
  });

  it('a person who no longer exists gets nothing (and the event is not an error)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(handleNotificationEvent(envelope('registration.approved', { userId: 'gone' }))).resolves.toBeUndefined();
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('a mail failure is an error, so the event is retried', async () => {
    (sendWelcomeEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(handleNotificationEvent(envelope('registration.approved', { userId: 'u1' }))).rejects.toThrow('smtp down');
  });
});

it('refuses an event type it does not know', async () => {
  await expect(handleNotificationEvent({ id: 'x'.repeat(10), type: 'something.else', version: 1, occurredAt: new Date().toISOString(), data: {} } as any)).rejects.toThrow(/unknown/i);
});
