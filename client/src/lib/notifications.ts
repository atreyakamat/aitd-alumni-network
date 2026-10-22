import { formatDistanceToNow } from 'date-fns';
import type { Notification } from '@/types';

/** Window event re-dispatched by useSocket for the server's `new_notification` emit. */
export const NEW_NOTIFICATION_EVENT = 'socket:new_notification';

/**
 * Older notification rows point at routes the client never had. Map them to
 * the closest real page (the server now emits the new forms directly).
 */
export function mapLegacyNotificationPath(path: string): string {
  const [pathname] = path.split(/[?#]/);
  // Post links now open the post page; only the bare list path has no page of its own.
  if (pathname === '/posts' || pathname === '/posts/') return '/dashboard';
  if (pathname === '/mentorship/requests' || pathname === '/mentorship/requests/') return '/mentorship';
  if (pathname === '/network/requests' || pathname === '/network/requests/') return '/network';
  const message = /^\/messages\/([^/]+)\/?$/.exec(pathname);
  if (message) {
    let partnerId = message[1];
    try {
      partnerId = decodeURIComponent(partnerId);
    } catch {
      // Keep the raw segment.
    }
    return `/messages?u=${encodeURIComponent(partnerId)}`;
  }
  return path;
}

/**
 * In-app path for a notification's `link`, or null when it should not be
 * followed (missing, external origin, protocol-relative, javascript:, ...).
 * Absolute URLs on the current origin are reduced to their path.
 */
export function getNotificationHref(
  notification: Pick<Notification, 'link' | 'linkUrl'>,
  origin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined
): string | null {
  const raw = (notification.link ?? notification.linkUrl ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) {
    return raw.startsWith('//') || raw.includes('\\') ? null : mapLegacyNotificationPath(raw);
  }
  if (!origin) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin) {
      return mapLegacyNotificationPath(`${url.pathname}${url.search}${url.hash}` || '/');
    }
  } catch {
    // Not a URL.
  }
  return null;
}

/** "5 minutes ago"; empty string for unparseable dates. */
export function formatNotificationTime(createdAt: string | Date | undefined, now?: Date): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  if (now && date > now) return 'just now';
  return formatDistanceToNow(date, { addSuffix: true });
}

/** Badge label for an unread count: hidden at 0, capped at "99+". */
export function formatBadgeCount(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
