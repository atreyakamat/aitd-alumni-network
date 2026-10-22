/**
 * Platform readiness control plane (PRD §7, §10).
 *
 * Feature statuses are maintained here by hand; module status is derived from
 * its features so the two can never disagree. Release-gate blockers are
 * computed from the data (PRD §10.3): an open P0/P1 feature in a Must Have
 * domain blocks a production release.
 */

export type ReadinessStatus = 'IMPLEMENTED' | 'PARTIAL' | 'PLANNED';
export type ReleaseRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type FeaturePriority = 'P0' | 'P1' | 'P2';

export interface FeatureReadiness {
  key: string;
  name: string;
  status: ReadinessStatus;
  notes: string;
  /** Release priority; P0/P1 gaps in Must Have domains block release. Defaults to P2. */
  priority?: FeaturePriority;
  /** Traceability to the implementation backlog / PRD section. */
  backlogRef?: string;
}

export interface ModuleReadiness {
  key: string;
  name: string;
  status: ReadinessStatus;
  risk: ReleaseRisk;
  owner: string;
  /** PRD §5 Status Target. */
  mustHave: boolean;
  features: FeatureReadiness[];
}

export interface ReleaseBlocker {
  module: string;
  feature: string;
  name: string;
  status: ReadinessStatus;
  priority: FeaturePriority;
  notes: string;
  backlogRef?: string;
}

/** IMPLEMENTED if every feature is implemented, PLANNED if none started, otherwise PARTIAL. */
export const deriveModuleStatus = (features: FeatureReadiness[]): ReadinessStatus => {
  if (features.length === 0) return 'PLANNED';
  if (features.every((f) => f.status === 'IMPLEMENTED')) return 'IMPLEMENTED';
  if (features.every((f) => f.status === 'PLANNED')) return 'PLANNED';
  return 'PARTIAL';
};

type ModuleDefinition = Omit<ModuleReadiness, 'status'>;

const definitions: ModuleDefinition[] = [
  {
    key: 'core-foundations',
    name: 'Core Platform Foundations',
    risk: 'MEDIUM',
    owner: 'Platform Team',
    mustHave: true,
    features: [
      { key: 'auth-lifecycle', name: 'Auth Lifecycle', status: 'IMPLEMENTED', priority: 'P0', notes: 'JWT access + refresh tokens and 2FA endpoints available.', backlogRef: 'PRD §6.2' },
      { key: 'role-normalization', name: 'Role Normalization & RBAC', status: 'IMPLEMENTED', priority: 'P0', notes: 'Central RBAC policy in src/config/permissions.ts (role hierarchy, normalizeRole, owner-or-admin checks) enforced server-side and covered by a route-level RBAC matrix test.', backlogRef: 'PRD §12.1' },
      { key: 'error-consistency', name: 'Error State Consistency', status: 'PARTIAL', priority: 'P2', notes: 'API returns structured { success, error: { message, code } } errors; client-side harmonization ongoing.', backlogRef: 'PRD §11.3' },
    ],
  },
  {
    key: 'auth-security',
    name: 'Authentication & Security',
    risk: 'LOW',
    owner: 'Security Team',
    mustHave: true,
    features: [
      { key: 'password-auth', name: 'Email + Password Auth', status: 'IMPLEMENTED', priority: 'P0', notes: 'Registration/login with hashed passwords.' },
      { key: 'two-factor', name: '2FA (Email OTP)', status: 'IMPLEMENTED', priority: 'P1', notes: 'Enable/disable/verify flows available.' },
      { key: 'oauth', name: 'OAuth Providers', status: 'IMPLEMENTED', priority: 'P2', notes: 'Google and LinkedIn with configuration gates.' },
      { key: 'privacy-rights', name: 'Privacy Export & Account Deletion', status: 'IMPLEMENTED', priority: 'P1', notes: 'Self-service data export (GET /users/me/export) and account deletion (DELETE /users/me), audited.', backlogRef: 'PRD §8.5' },
    ],
  },
  {
    key: 'jobs-referrals',
    name: 'Jobs & Referrals',
    risk: 'LOW',
    owner: 'Careers Team',
    mustHave: true,
    features: [
      { key: 'job-posting', name: 'Job Posting', status: 'IMPLEMENTED', priority: 'P1', notes: 'Create/list/detail/update/delete with admin moderation queue.' },
      { key: 'job-discovery', name: 'Job Search & Filters', status: 'IMPLEMENTED', priority: 'P1', notes: 'Search, type, and pagination supported.' },
      { key: 'invite-batchmates', name: 'Invite Batchmates', status: 'IMPLEMENTED', priority: 'P2', notes: 'Single + bulk invite and tracking endpoints present.' },
    ],
  },
  {
    key: 'mentorship',
    name: 'Mentorship',
    risk: 'LOW',
    owner: 'Mentorship Team',
    mustHave: true,
    features: [
      { key: 'mentor-profile', name: 'Mentor Profile', status: 'IMPLEMENTED', priority: 'P1', notes: 'Create/update/remove profile supported.' },
      { key: 'mentorship-requests', name: 'Mentorship Requests', status: 'IMPLEMENTED', priority: 'P1', notes: 'Request/respond/end flows implemented.' },
      { key: 'mentorship-overview', name: 'Mentorship Reporting', status: 'IMPLEMENTED', priority: 'P2', notes: 'Admin mentorship overview (GET /admin/mentorship/overview).', backlogRef: 'PRD §12.2' },
    ],
  },
  {
    key: 'events-community',
    name: 'Events & Community',
    risk: 'LOW',
    owner: 'Community Team',
    mustHave: true,
    features: [
      { key: 'events-rsvp', name: 'Events and RSVP', status: 'IMPLEMENTED', priority: 'P1', notes: 'Lifecycle and attendee APIs available.' },
      { key: 'gallery-news', name: 'Gallery & News', status: 'IMPLEMENTED', priority: 'P2', notes: 'Content creation and discovery available.' },
      { key: 'chapters-marketplace', name: 'Chapters & Marketplace', status: 'IMPLEMENTED', priority: 'P2', notes: 'CRUD and membership flows available.' },
    ],
  },
  {
    key: 'revenue',
    name: 'Memberships, Donations & Transactions',
    risk: 'LOW',
    owner: 'Revenue Team',
    mustHave: true,
    features: [
      { key: 'membership-purchase', name: 'Membership Purchase', status: 'IMPLEMENTED', priority: 'P0', notes: 'Server-priced Razorpay orders, idempotent owner-only verification, expiry-aware active membership.', backlogRef: 'PRD §6.8' },
      { key: 'donations', name: 'Donations', status: 'IMPLEMENTED', priority: 'P0', notes: 'Validated amounts, HMAC-SHA256 timing-safe signature verification, anonymous donors hidden publicly.', backlogRef: 'PRD §6.8' },
      { key: 'receipts', name: 'Transaction Receipts', status: 'IMPLEMENTED', priority: 'P1', notes: 'Owner/admin-only PDF receipts with deterministic receipt numbers for successful transactions.', backlogRef: 'PRD §12.3' },
      { key: 'payment-webhook', name: 'Razorpay Webhook', status: 'IMPLEMENTED', priority: 'P1', notes: 'POST /payments/webhook/razorpay: raw-body HMAC verification, amount check, idempotent completion shared with client verify, including guest donations (PENDING Transaction with userId NULL + donor details in metadata, receipt e-mailed). Amount/currency mismatches are left PENDING, audited (PAYMENT_MISMATCH) and notified to admins. Needs RAZORPAY_WEBHOOK_SECRET (503 while unset).', backlogRef: 'PRD §6.8' },
      { key: 'payment-degradation', name: 'Payment Graceful Degradation', status: 'IMPLEMENTED', priority: 'P1', notes: 'Missing Razorpay credentials return 503 PAYMENT_NOT_CONFIGURED instead of failing at boot.', backlogRef: 'PRD §8.3' },
    ],
  },
  {
    key: 'admin-analytics',
    name: 'Admin & Analytics',
    risk: 'LOW',
    owner: 'Admin Ops',
    mustHave: true,
    features: [
      { key: 'admin-dashboard', name: 'Admin Dashboard Metrics', status: 'IMPLEMENTED', priority: 'P1', notes: 'Cross-domain stats endpoint available.' },
      { key: 'admin-user-management', name: 'Admin User Management', status: 'IMPLEMENTED', priority: 'P1', notes: 'User listing, role changes and activation guarded by the RBAC policy and audited.', backlogRef: 'PRD §6.10' },
      { key: 'csv-exports', name: 'CSV Exports', status: 'IMPLEMENTED', priority: 'P2', notes: 'Admin CSV exports (GET /admin/export/:entity).', backlogRef: 'PRD §12.3' },
      { key: 'audit-logs', name: 'Audit Log Operations', status: 'IMPLEMENTED', priority: 'P1', notes: 'Filterable audit queries; retention cleanup with a 30-day floor (super admin only).' },
      { key: 'release-readiness', name: 'Release Readiness Controls', status: 'IMPLEMENTED', priority: 'P1', notes: 'Readiness API with derived module status, release-gate blockers and backlog traceability.', backlogRef: 'PRD §10' },
    ],
  },
  {
    key: 'strategic-enhancements',
    name: 'Strategic Enhancements (Phase D)',
    risk: 'LOW',
    owner: 'Product',
    mustHave: false,
    features: [
      { key: 'ai-matching', name: 'AI Mentor Matching', status: 'PLANNED', priority: 'P2', notes: 'Planned as post-launch enhancement.', backlogRef: 'PRD §12.4' },
      { key: 'push-notifications', name: 'Push Notification Channel', status: 'PLANNED', priority: 'P2', notes: 'Planned as post-launch enhancement.', backlogRef: 'PRD §12.4' },
      { key: 'mobile-apps', name: 'Mobile Apps', status: 'PLANNED', priority: 'P2', notes: 'Planned as post-launch enhancement.', backlogRef: 'PRD §12.4' },
      { key: 'video-sessions', name: 'Video Session Integrations', status: 'PLANNED', priority: 'P2', notes: 'Planned as post-launch enhancement.', backlogRef: 'PRD §12.4' },
    ],
  },
];

export const buildModuleReadiness = (defs: ModuleDefinition[]): ModuleReadiness[] =>
  defs.map((def) => ({ ...def, status: deriveModuleStatus(def.features) }));

export const moduleReadiness: ModuleReadiness[] = buildModuleReadiness(definitions);

/** PRD §10.3: open (non-implemented) P0/P1 features in Must Have domains. */
export const getReleaseBlockers = (modules: ModuleReadiness[] = moduleReadiness): ReleaseBlocker[] =>
  modules
    .filter((m) => m.mustHave)
    .flatMap((m) =>
      m.features
        .filter((f) => f.status !== 'IMPLEMENTED' && (f.priority === 'P0' || f.priority === 'P1'))
        .map((f) => ({
          module: m.key,
          feature: f.key,
          name: f.name,
          status: f.status,
          priority: f.priority as FeaturePriority,
          notes: f.notes,
          backlogRef: f.backlogRef,
        }))
    );

/** Non-implemented features of any priority (drill-down list for the control surface). */
export const getOpenGaps = (modules: ModuleReadiness[] = moduleReadiness) =>
  modules.flatMap((m) =>
    m.features
      .filter((f) => f.status !== 'IMPLEMENTED')
      .map((f) => ({ module: m.key, feature: f.key, name: f.name, status: f.status, priority: f.priority ?? 'P2', backlogRef: f.backlogRef }))
  );
