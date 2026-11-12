import { NotificationType, NotificationCategory } from '@prisma/client';
import {
  notificationPreferenceService,
  NOTIFICATION_CATEGORIES,
  CATEGORY_OF_TYPE,
  ALWAYS_DELIVERED_TYPES,
  ALWAYS_SENT_EMAILS,
  categoryOf,
} from '../../services/notificationPreferenceService';
import { updateNotificationPreferencesSchema } from '../../utils/validators';
import { api, authAs, prismaMock } from '../../../tests/helpers';

const ME = 'user-1';
const ALL_TYPES = Object.values(NotificationType) as NotificationType[];

describe('categories and the never-switchable list', () => {
  it('every notification type belongs to a category a member can switch, or to the always-delivered list (nothing is left out)', () => {
    for (const type of ALL_TYPES) {
      expect(type in CATEGORY_OF_TYPE).toBe(true);
      const category = CATEGORY_OF_TYPE[type];
      const locked = ALWAYS_DELIVERED_TYPES.includes(type);
      expect({ type, switchable: category !== null, locked }).toEqual({ type, switchable: !locked, locked });
      if (category !== null) expect(NOTIFICATION_CATEGORIES).toContain(category);
    }
  });

  it('account, approval, membership and administrator work items are always delivered', () => {
    expect([...ALWAYS_DELIVERED_TYPES].sort()).toEqual(['CONTENT_REPORTED', 'MEMBERSHIP_EXPIRY', 'REGISTRATION_PENDING']);
    for (const type of ALWAYS_DELIVERED_TYPES) expect(categoryOf(type)).toBeNull();
  });

  it('the e-mails that must always be sent are named (registration, password, 2FA, verification, receipts)', () => {
    for (const kind of ['registration.received', 'registration.approved', 'registration.rejected', 'registration.submitted', 'password-changed', 'two-factor', 'verification', 'donation-receipt']) {
      expect(ALWAYS_SENT_EMAILS).toContain(kind);
    }
  });

  it('the categories in code are exactly the ones the database enum can store', () => {
    expect([...NOTIFICATION_CATEGORIES].sort()).toEqual(Object.values(NotificationCategory).sort());
  });

  it('maps the usual types to sensible categories', () => {
    expect(categoryOf('CONNECTION_REQUEST')).toBe('CONNECTIONS');
    expect(categoryOf('NEW_FOLLOWER')).toBe('CONNECTIONS');
    expect(categoryOf('MESSAGE_RECEIVED')).toBe('MESSAGES');
    expect(categoryOf('POST_LIKED')).toBe('POSTS_AND_COMMENTS');
    expect(categoryOf('MENTION')).toBe('POSTS_AND_COMMENTS');
    expect(categoryOf('EVENT_RSVP')).toBe('EVENTS');
    expect(categoryOf('JOB_MATCH')).toBe('JOBS_AND_MENTORSHIP');
    expect(categoryOf('MENTORSHIP_REQUEST')).toBe('JOBS_AND_MENTORSHIP');
    expect(categoryOf('ADMIN_ANNOUNCEMENT')).toBe('ANNOUNCEMENTS');
  });
});

describe('getPreferences', () => {
  it('everything is on when the member never changed anything (no rows)', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([]);
    const result = await notificationPreferenceService.getPreferences(ME);
    expect(prismaMock.notificationPreference.findMany.mock.calls[0][0].where).toEqual({ userId: ME });
    expect(result.preferences.map((p) => p.category)).toEqual([...NOTIFICATION_CATEGORIES]);
    expect(result.preferences.every((p) => p.inApp && p.email)).toBe(true);
    expect(result.alwaysOn).toEqual(['ACCOUNT_AND_SECURITY']);
  });

  it('shows what the member chose and leaves the other categories on', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ category: 'MESSAGES', inApp: false, email: true }]);
    const { preferences } = await notificationPreferenceService.getPreferences(ME);
    expect(preferences.find((p) => p.category === 'MESSAGES')).toEqual({ category: 'MESSAGES', inApp: false, email: true });
    expect(preferences.find((p) => p.category === 'EVENTS')).toEqual({ category: 'EVENTS', inApp: true, email: true });
  });

  it('exposes only the three fields (no row id, no user id)', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ id: 'x', userId: ME, category: 'EVENTS', inApp: false, email: false, createdAt: new Date() }]);
    const { preferences } = await notificationPreferenceService.getPreferences(ME);
    expect(Object.keys(preferences[3]).sort()).toEqual(['category', 'email', 'inApp']);
  });
});

describe('updatePreferences', () => {
  beforeEach(() => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({});
    prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  });

  it('upserts one row per category for this member only, writing just the fields that were sent', async () => {
    await notificationPreferenceService.updatePreferences(ME, [
      { category: 'MESSAGES', inApp: false },
      { category: 'EVENTS', inApp: false, email: false },
    ]);
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.notificationPreference.upsert.mock.calls[0][0]).toEqual({
      where: { userId_category: { userId: ME, category: 'MESSAGES' } },
      create: { userId: ME, category: 'MESSAGES', inApp: false },
      update: { inApp: false },
    });
    expect(prismaMock.notificationPreference.upsert.mock.calls[1][0]).toEqual({
      where: { userId_category: { userId: ME, category: 'EVENTS' } },
      create: { userId: ME, category: 'EVENTS', inApp: false, email: false },
      update: { inApp: false, email: false },
    });
  });

  it('returns the full list afterwards', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ category: 'MESSAGES', inApp: false, email: true }]);
    const result = await notificationPreferenceService.updatePreferences(ME, [{ category: 'MESSAGES', inApp: false }]);
    expect(result.preferences).toHaveLength(NOTIFICATION_CATEGORIES.length);
  });
});

describe('request validation', () => {
  const parse = (body: unknown) => updateNotificationPreferencesSchema.safeParse({ body });
  const ok = { preferences: [{ category: 'MESSAGES', inApp: false, email: true }] };

  it('accepts a list of {category, inApp, email}', () => {
    expect(parse(ok).success).toBe(true);
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: false }] }).success).toBe(true);
  });

  it('rejects an unknown category, and the always-on category (it has no setting)', () => {
    expect(parse({ preferences: [{ category: 'NOPE', inApp: false }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'ACCOUNT_AND_SECURITY', inApp: false }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'REGISTRATION_PENDING', inApp: false }] }).success).toBe(false);
  });

  it('rejects non-boolean values, an empty change, duplicates, an empty or oversized list', () => {
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: 'false' }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: 0 }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'EVENTS' }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: false }, { category: 'EVENTS', email: false }] }).success).toBe(false);
    expect(parse({ preferences: [] }).success).toBe(false);
    const many = Array.from({ length: 200 }, () => ({ category: 'EVENTS', inApp: false }));
    expect(parse({ preferences: many }).success).toBe(false);
    expect(parse({}).success).toBe(false);
    expect(parse(null).success).toBe(false);
    expect(parse([{ category: 'EVENTS', inApp: false }]).success).toBe(false);
  });

  it('rejects extra fields instead of passing them on (mass assignment)', () => {
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: false, userId: 'someone-else' }] }).success).toBe(false);
    expect(parse({ preferences: [{ category: 'EVENTS', inApp: false, id: 'x' }] }).success).toBe(false);
    expect(parse({ ...ok, userId: 'someone-else' }).success).toBe(false);
  });
});

describe('isEnabled: whether one notification may be delivered on one channel', () => {
  it('is on without a stored row', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
    await expect(notificationPreferenceService.isEnabled(ME, 'POST_LIKED', 'inApp')).resolves.toBe(true);
    await expect(notificationPreferenceService.isEnabled(ME, 'POST_LIKED', 'email')).resolves.toBe(true);
  });

  it('honours an opt-out per channel, for the right category and the right member', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({ inApp: false, email: true });
    await expect(notificationPreferenceService.isEnabled(ME, 'POST_LIKED', 'inApp')).resolves.toBe(false);
    await expect(notificationPreferenceService.isEnabled(ME, 'POST_LIKED', 'email')).resolves.toBe(true);
    expect(prismaMock.notificationPreference.findUnique.mock.calls[0][0].where).toEqual({ userId_category: { userId: ME, category: 'POSTS_AND_COMMENTS' } });
  });

  it.each(ALWAYS_DELIVERED_TYPES.map((t) => [t]))('%s ignores preferences completely (never even looked up)', async (type) => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({ inApp: false, email: false });
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: ME, inApp: false, email: false }]);
    await expect(notificationPreferenceService.isEnabled(ME, type, 'inApp')).resolves.toBe(true);
    await expect(notificationPreferenceService.isEnabled(ME, type, 'email')).resolves.toBe(true);
    expect((await notificationPreferenceService.optedOutUserIds([ME], type, 'inApp')).size).toBe(0);
    expect(prismaMock.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.notificationPreference.findMany).not.toHaveBeenCalled();
  });

  it('delivers when the settings cannot be read (a lost notice is worse than an unwanted one)', async () => {
    prismaMock.notificationPreference.findUnique.mockRejectedValue(new Error('db down'));
    await expect(notificationPreferenceService.isEnabled(ME, 'POST_LIKED', 'inApp')).resolves.toBe(true);
  });
});

describe('optedOutUserIds', () => {
  it('returns the members, among those given, who switched that channel off for that category (one query)', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ userId: 'b' }]);
    const out = await notificationPreferenceService.optedOutUserIds(['a', 'b', 'c'], 'ADMIN_ANNOUNCEMENT', 'inApp');
    expect([...out]).toEqual(['b']);
    expect(prismaMock.notificationPreference.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationPreference.findMany.mock.calls[0][0].where).toEqual({
      userId: { in: ['a', 'b', 'c'] },
      category: 'ANNOUNCEMENTS',
      inApp: false,
    });
  });

  it('does not query for nobody, and treats a read failure as "nobody opted out"', async () => {
    expect((await notificationPreferenceService.optedOutUserIds([], 'POST_LIKED', 'inApp')).size).toBe(0);
    expect(prismaMock.notificationPreference.findMany).not.toHaveBeenCalled();
    prismaMock.notificationPreference.findMany.mockRejectedValue(new Error('db down'));
    expect((await notificationPreferenceService.optedOutUserIds(['a'], 'POST_LIKED', 'inApp')).size).toBe(0);
  });
});

describe('routes', () => {
  it('GET /api/notifications/preferences answers with the caller\'s own settings and is not captured by /notifications/:id', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ category: 'EVENTS', inApp: false, email: false }]);
    const res = await api().get('/api/notifications/preferences').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prismaMock.notificationPreference.findMany.mock.calls[0][0].where).toEqual({ userId: user.id });
    expect(res.body.data.preferences.find((p: { category: string }) => p.category === 'EVENTS')).toEqual({ category: 'EVENTS', inApp: false, email: false });
    expect(res.body.data.alwaysOn).toEqual(['ACCOUNT_AND_SECURITY']);
  });

  it('PUT /api/notifications/preferences writes the caller\'s rows, whatever user id the body carries is refused', async () => {
    const { header, user } = authAs('MEMBER');
    prismaMock.notificationPreference.upsert.mockResolvedValue({});
    prismaMock.notificationPreference.findMany.mockResolvedValue([]);
    const res = await api().put('/api/notifications/preferences').set('Authorization', header).send({ preferences: [{ category: 'MESSAGES', inApp: false }] });
    expect(res.status).toBe(200);
    expect(prismaMock.notificationPreference.upsert.mock.calls[0][0].where).toEqual({ userId_category: { userId: user.id, category: 'MESSAGES' } });

    prismaMock.notificationPreference.upsert.mockClear();
    const smuggled = await api()
      .put('/api/notifications/preferences')
      .set('Authorization', header)
      .send({ preferences: [{ category: 'MESSAGES', inApp: false, userId: 'someone-else' }] });
    expect(smuggled.status).toBe(400);
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('PUT with an unknown category is a 400 with the usual error shape', async () => {
    const { header } = authAs('MEMBER');
    const res = await api().put('/api/notifications/preferences').set('Authorization', header).send({ preferences: [{ category: 'REGISTRATION_PENDING', inApp: false }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('both need a signed-in member', async () => {
    expect((await api().get('/api/notifications/preferences')).status).toBe(401);
    expect((await api().put('/api/notifications/preferences').send({ preferences: [] })).status).toBe(401);
  });
});
