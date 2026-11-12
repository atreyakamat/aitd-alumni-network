/**
 * ROUND 3 / F3, F4 (R3-12, R3-13) - the notification bus (Kafka, or in-process without a broker).
 *
 *  1. Only server code can cause an event: no controller or route touches the bus, and the few service-level callers are pinned,
 *     so a new HTTP path to `notification.deliver` / `notification.broadcast` has to be a conscious change.
 *  2. What the consumer accepts is validated: a forged or buggy envelope cannot store an external or script link, a 5 MB metadata
 *     blob or a megabyte title; it is refused (and, through Kafka, ends up in the dead-letter topic) instead of being stored.
 *  3. A broadcast reaches approved, active members only: an applicant who is waiting for approval (or was turned down) is not a
 *     member and must not collect the community's announcements.
 */
import fs from 'fs';
import path from 'path';
import { createUser, prisma } from '../../integration/helpers';
import { fanOutNotification } from '../../../src/services/broadcastService';
import { handleNotificationEvent } from '../../../src/services/notificationEventHandlers';
import { buildEnvelope, EventValidationError, parseEnvelope } from '../../../src/services/notificationEvents';

afterAll(async () => {
  await prisma.$disconnect();
});

const SRC = path.resolve(__dirname, '../../../src');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');

describe('1. who can cause an event', () => {
  it('no controller, route or middleware reaches the bus or creates notifications directly', () => {
    const offenders = walk(SRC)
      .filter((file) => /^(controllers|routes|middleware)\//.test(rel(file)))
      .filter((file) => /notificationBus|publishNotificationEvent|createNotification\(|broadcastNotification\(|fanOutNotification\(|notificationEvents/.test(fs.readFileSync(file, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('only these server modules publish to the bus (a new one is a decision, not an accident)', () => {
    const publishers = walk(SRC)
      .filter((file) => /publishNotificationEvent\(/.test(fs.readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => file !== 'services/notificationBus.ts')
      .sort();
    expect(publishers).toEqual(['services/authService.ts', 'services/broadcastService.ts', 'services/memberApprovalService.ts', 'services/notificationService.ts']);
  });

  it('every HTTP route with "notification" in its path is the member\'s own list, read and delete: none accepts an event', () => {
    const source = fs.readFileSync(path.join(SRC, 'routes/index.ts'), 'utf8');
    const routes = [...source.matchAll(/router\.(get|post|put|patch|delete)\('([^']*notification[^']*)'/gi)].map((m) => `${m[1]} ${m[2]}`);
    // preferences: the member's own settings (a fixed list of categories and booleans), not an event
    expect(routes.sort()).toEqual(
      [
        'delete /notifications/:id',
        'get /notifications',
        'get /notifications/preferences',
        'get /notifications/unread',
        'post /notifications/:id/read',
        'post /notifications/read-all',
        'put /notifications/preferences',
      ].sort()
    );
  });
});

describe('2. a forged or faulty envelope is refused, not stored', () => {
  const deliver = (data: Record<string, unknown>) =>
    parseEnvelope({ id: 'evt-0000-forged', type: 'notification.deliver', version: 1, occurredAt: new Date().toISOString(), data });
  const ok = { userId: 'u1', type: 'ADMIN_ANNOUNCEMENT', title: 'Hello', message: 'World' };

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    '\\\\evil.example',
    'vbscript:msgbox(1)',
    '/posts/1\r\nSet-Cookie: x=1',
    '/' + 'a'.repeat(3000),
  ])('refuses the link %#', (link) => {
    expect(() => deliver({ ...ok, link })).toThrow(EventValidationError);
  });

  it.each(['/posts/abc?comment=1', '/profile/0b6c', '/mentorship', '/admin/approvals'])('keeps accepting the site path %s', (link) => {
    expect(deliver({ ...ok, link }).data).toMatchObject({ link });
  });

  it('refuses a megabyte title, a megabyte message and a 5 MB metadata blob', () => {
    expect(() => deliver({ ...ok, title: 'x'.repeat(1_000_000) })).toThrow(EventValidationError);
    expect(() => deliver({ ...ok, message: 'x'.repeat(1_000_000) })).toThrow(EventValidationError);
    expect(() => deliver({ ...ok, metadata: { blob: 'x'.repeat(5_000_000) } })).toThrow(EventValidationError);
  });

  it('the broadcast schema is held to the same rules', () => {
    const broadcast = (data: Record<string, unknown>) =>
      parseEnvelope({ id: 'evt-0000-forged', type: 'notification.broadcast', version: 1, occurredAt: new Date().toISOString(), data });
    expect(() => broadcast({ type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'm', link: 'javascript:alert(1)' })).toThrow(EventValidationError);
    expect(() => broadcast({ type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'x'.repeat(100_000) })).toThrow(EventValidationError);
    expect(broadcast({ type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'm', link: '/news/x' }).data).toMatchObject({ link: '/news/x' });
  });

  it('building an envelope in the server validates the same way (the producer cannot send what the consumer would refuse)', () => {
    expect(() => buildEnvelope('notification.deliver', { ...ok, link: 'https://evil.example' } as never)).toThrow(EventValidationError);
  });

  it('an event for a member who does not exist is an error for the retry/dead-letter path, never a crash or a stored row', async () => {
    const envelope = buildEnvelope('notification.deliver', { ...ok, userId: '00000000-0000-4000-8000-00000000dead' } as never);
    await expect(handleNotificationEvent(envelope)).rejects.toBeDefined();
    expect(await prisma.notification.count({ where: { userId: '00000000-0000-4000-8000-00000000dead' } })).toBe(0);
  });

  it('an unknown event type, a wrong version and a missing field are refused', () => {
    expect(() => parseEnvelope({ id: 'evt-0000-forged', type: 'notification.delete_everything', version: 1, occurredAt: 'x', data: {} })).toThrow(EventValidationError);
    expect(() => parseEnvelope({ id: 'evt-0000-forged', type: 'notification.deliver', version: 2, occurredAt: 'x', data: ok })).toThrow(EventValidationError);
    expect(() => deliver({ type: 'ADMIN_ANNOUNCEMENT', title: 'no recipient', message: 'm' })).toThrow(EventValidationError);
  });
});

describe('3. a broadcast reaches approved, active members only', () => {
  it('skips registrations that are pending or rejected, and deactivated accounts', async () => {
    const member = await createUser('MEMBER');
    const pending = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false });
    const rejected = await createUser('MEMBER', { approvalStatus: 'REJECTED', isVerified: false });
    const deactivated = await createUser('MEMBER', { isActive: false });
    const marker = `r3-broadcast-${Date.now()}`;

    await fanOutNotification({ type: 'ADMIN_ANNOUNCEMENT', title: marker, message: 'for members', link: '/news/x' });

    const got = async (userId: string) => prisma.notification.count({ where: { userId, title: marker } });
    expect(await got(member.user.id)).toBe(1);
    expect(await got(pending.user.id)).toBe(0);
    expect(await got(rejected.user.id)).toBe(0);
    expect(await got(deactivated.user.id)).toBe(0);
  });
});
