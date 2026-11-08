/**
 * In-app links stored on notifications. Every path must exist in client/src/app;
 * src/__tests__/utils/clientLinks.test.ts checks them against the client's routes.
 */
const id = (value: string) => encodeURIComponent(value);

export const clientLinks = {
  feed: () => '/dashboard',
  mentorship: () => '/mentorship',
  network: () => '/network',
  conversation: (userId: string) => `/messages?u=${id(userId)}`,
  profile: (userId: string) => `/profile/${id(userId)}`,
  /** A post, optionally scrolled to one of its comments. */
  post: (postId: string, commentId?: string) =>
    commentId ? `/posts/${id(postId)}#comment-${id(commentId)}` : `/posts/${id(postId)}`,
  hashtag: (tag: string) => `/hashtags/${id(tag)}`,
  saved: () => '/saved',
  videos: () => '/videos',
  adminVideos: () => '/admin/videos',
  magazine: () => '/magazine',
  requirements: () => '/requirements',
  adminRequirements: () => '/admin/requirements',
  referrals: () => '/referrals',
  adminReports: () => '/admin/reports',
  event: (eventId: string) => `/events/${id(eventId)}`,
  job: (jobId: string) => `/jobs/${id(jobId)}`,
  adminDashboard: () => '/admin',
  /** Admin audit log, optionally pre-filtered by action (e.g. PAYMENT_MISMATCH). */
  adminAudit: (action?: string) => (action ? `/admin/audit?action=${id(action)}` : '/admin/audit'),
};
