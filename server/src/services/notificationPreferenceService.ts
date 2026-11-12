import type { NotificationType } from '@prisma/client';
import prisma from '../config/database';
import { log } from '../utils/logger';

/**
 * What a member wants to hear about. Per category they can switch the in-app (bell) notification and the e-mail on or off.
 *
 * Rules, all enforced here and nowhere else:
 *  - Everything is on until the member changes it: no row means on.
 *  - Notices about the account, the approval of a registration, security and payments are never switchable. They have no
 *    category in the database (the enum cannot store them), so a request cannot turn them off and a bug cannot either.
 *  - If the settings cannot be read, the notification is delivered: a lost notice is worse than an unwanted one.
 */
export const NOTIFICATION_CATEGORIES = ['CONNECTIONS', 'MESSAGES', 'POSTS_AND_COMMENTS', 'EVENTS', 'JOBS_AND_MENTORSHIP', 'ANNOUNCEMENTS'] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Shown to members as one "always on" row (the client words it). It is not a stored category.
 */
export const ALWAYS_ON_CATEGORY = 'ACCOUNT_AND_SECURITY';

/**
 * Every notification type, and the category that governs it (null = always delivered). Typed as a full record, so adding a
 * type to the schema without deciding where it belongs does not compile.
 *
 * ADMIN_ANNOUNCEMENT is switchable: it carries college news and also the reminders administrators get about work waiting
 * for them (video submissions, offers to help, referral asks). An administrator who switches announcements off stops those
 * too. The urgent ones (a payment that needs reconciling) are sent with `essential: true` and are never suppressed.
 */
export const CATEGORY_OF_TYPE: Record<NotificationType, NotificationCategoryKey | null> = {
  CONNECTION_REQUEST: 'CONNECTIONS',
  CONNECTION_ACCEPTED: 'CONNECTIONS',
  NEW_FOLLOWER: 'CONNECTIONS',
  MESSAGE_RECEIVED: 'MESSAGES',
  POST_LIKED: 'POSTS_AND_COMMENTS',
  POST_COMMENTED: 'POSTS_AND_COMMENTS',
  POST_REACTED: 'POSTS_AND_COMMENTS',
  COMMENT_REPLIED: 'POSTS_AND_COMMENTS',
  COMMENT_REACTED: 'POSTS_AND_COMMENTS',
  POST_REPOSTED: 'POSTS_AND_COMMENTS',
  MENTION: 'POSTS_AND_COMMENTS',
  EVENT_RSVP: 'EVENTS',
  JOB_MATCH: 'JOBS_AND_MENTORSHIP',
  MENTORSHIP_REQUEST: 'JOBS_AND_MENTORSHIP',
  MENTORSHIP_ACCEPTED: 'JOBS_AND_MENTORSHIP',
  MENTORSHIP_DECLINED: 'JOBS_AND_MENTORSHIP',
  MENTORSHIP_SESSION: 'JOBS_AND_MENTORSHIP',
  ADMIN_ANNOUNCEMENT: 'ANNOUNCEMENTS',
  // Always delivered: the member's own membership, and the work items administrators exist to handle
  MEMBERSHIP_EXPIRY: null,
  REGISTRATION_PENDING: null,
  CONTENT_REPORTED: null,
};

/** The types that ignore the member's settings. */
export const ALWAYS_DELIVERED_TYPES = (Object.keys(CATEGORY_OF_TYPE) as NotificationType[]).filter((type) => CATEGORY_OF_TYPE[type] === null);

/**
 * The e-mails that are not notifications of a type (they have no switch at all): registration and approval, sign-in and
 * security, receipts. Listed so the rule is visible and tested; sending code does not consult the settings for them.
 */
export const ALWAYS_SENT_EMAILS = [
  'registration.received',
  'registration.submitted',
  'registration.approved',
  'registration.rejected',
  'verification',
  'password-reset',
  'password-changed',
  'two-factor',
  'donation-receipt',
  'invite',
] as const;

export type Channel = 'inApp' | 'email';

export interface CategoryPreference {
  category: NotificationCategoryKey;
  inApp: boolean;
  email: boolean;
}

export interface PreferenceUpdate {
  category: NotificationCategoryKey;
  inApp?: boolean;
  email?: boolean;
}

export const categoryOf = (type: NotificationType): NotificationCategoryKey | null => CATEGORY_OF_TYPE[type] ?? null;

export class NotificationPreferenceService {
  async getPreferences(userId: string): Promise<{ preferences: CategoryPreference[]; alwaysOn: string[] }> {
    const rows = (await prisma.notificationPreference.findMany({ where: { userId } })) ?? [];
    const byCategory = new Map(rows.map((row) => [row.category as string, row]));
    return {
      preferences: NOTIFICATION_CATEGORIES.map((category) => {
        const row = byCategory.get(category);
        return { category, inApp: row?.inApp ?? true, email: row?.email ?? true };
      }),
      alwaysOn: [ALWAYS_ON_CATEGORY],
    };
  }

  /** Changes only the categories and channels that are named; the rest stay as they were. Own rows only. */
  async updatePreferences(userId: string, changes: PreferenceUpdate[]) {
    await prisma.$transaction(
      changes.map(({ category, inApp, email }) => {
        const values = { ...(inApp === undefined ? {} : { inApp }), ...(email === undefined ? {} : { email }) };
        return prisma.notificationPreference.upsert({
          where: { userId_category: { userId, category } },
          create: { userId, category, ...values },
          update: values,
        });
      })
    );
    return this.getPreferences(userId);
  }

  /** May this notification be delivered to this member on this channel? */
  async isEnabled(userId: string, type: NotificationType, channel: Channel): Promise<boolean> {
    const category = categoryOf(type);
    if (category === null) return true;
    try {
      const row = await prisma.notificationPreference.findUnique({ where: { userId_category: { userId, category } } });
      return row ? row[channel] : true;
    } catch (error) {
      log.warn('Could not read notification settings; delivering', { userId, category, err: error });
      return true;
    }
  }

  /** Of these members, who switched this channel off for this type's category? One query, for fan-outs. */
  async optedOutUserIds(userIds: string[], type: NotificationType, channel: Channel): Promise<Set<string>> {
    const category = categoryOf(type);
    if (category === null || userIds.length === 0) return new Set();
    try {
      const rows = (await prisma.notificationPreference.findMany({
        where: { userId: { in: userIds }, category, [channel]: false },
        select: { userId: true },
      })) ?? [];
      return new Set(rows.map((row) => row.userId));
    } catch (error) {
      log.warn('Could not read notification settings; delivering to everybody', { category, err: error });
      return new Set();
    }
  }
}

export const notificationPreferenceService = new NotificationPreferenceService();
