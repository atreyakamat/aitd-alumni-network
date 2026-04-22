export type ReadinessStatus = 'IMPLEMENTED' | 'PARTIAL' | 'PLANNED';
export type ReleaseRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FeatureReadiness {
  key: string;
  name: string;
  status: ReadinessStatus;
  notes: string;
}

export interface ModuleReadiness {
  key: string;
  name: string;
  status: ReadinessStatus;
  risk: ReleaseRisk;
  owner: string;
  features: FeatureReadiness[];
}

export const moduleReadiness: ModuleReadiness[] = [
  {
    key: 'core-foundations',
    name: 'Core Platform Foundations',
    status: 'PARTIAL',
    risk: 'HIGH',
    owner: 'Platform Team',
    features: [
      { key: 'auth-lifecycle', name: 'Auth Lifecycle', status: 'IMPLEMENTED', notes: 'JWT + refresh + 2FA endpoints available.' },
      { key: 'role-normalization', name: 'Role Normalization', status: 'PARTIAL', notes: 'Requires strict frontend role mapping consistency.' },
      { key: 'error-consistency', name: 'Error State Consistency', status: 'PARTIAL', notes: 'Most routes return structured errors; client harmonization ongoing.' },
    ],
  },
  {
    key: 'auth-security',
    name: 'Authentication & Security',
    status: 'IMPLEMENTED',
    risk: 'LOW',
    owner: 'Security Team',
    features: [
      { key: 'password-auth', name: 'Email + Password Auth', status: 'IMPLEMENTED', notes: 'Registration/login with hashed passwords.' },
      { key: 'two-factor', name: '2FA (Email OTP)', status: 'IMPLEMENTED', notes: 'Enable/disable/verify flows available.' },
      { key: 'oauth', name: 'OAuth Providers', status: 'IMPLEMENTED', notes: 'Google and LinkedIn with configuration gates.' },
    ],
  },
  {
    key: 'jobs-referrals',
    name: 'Jobs & Referrals',
    status: 'IMPLEMENTED',
    risk: 'LOW',
    owner: 'Careers Team',
    features: [
      { key: 'job-posting', name: 'Job Posting', status: 'IMPLEMENTED', notes: 'Create/list/detail/update/delete and moderation present.' },
      { key: 'job-discovery', name: 'Job Search & Filters', status: 'IMPLEMENTED', notes: 'Search, type, and pagination supported.' },
      { key: 'invite-batchmates', name: 'Invite Batchmates', status: 'IMPLEMENTED', notes: 'Single + bulk invite and tracking endpoints present.' },
    ],
  },
  {
    key: 'mentorship',
    name: 'Mentorship',
    status: 'PARTIAL',
    risk: 'MEDIUM',
    owner: 'Mentorship Team',
    features: [
      { key: 'mentor-profile', name: 'Mentor Profile', status: 'IMPLEMENTED', notes: 'Create/update/remove profile supported.' },
      { key: 'mentorship-requests', name: 'Mentorship Requests', status: 'IMPLEMENTED', notes: 'Request/respond/end flows implemented.' },
      { key: 'ai-matching', name: 'AI Matching', status: 'PLANNED', notes: 'Planned as post-launch enhancement.' },
    ],
  },
  {
    key: 'events-community',
    name: 'Events & Community',
    status: 'IMPLEMENTED',
    risk: 'LOW',
    owner: 'Community Team',
    features: [
      { key: 'events-rsvp', name: 'Events and RSVP', status: 'IMPLEMENTED', notes: 'Lifecycle and attendee APIs available.' },
      { key: 'gallery-news', name: 'Gallery & News', status: 'IMPLEMENTED', notes: 'Content creation and discovery available.' },
      { key: 'chapters-marketplace', name: 'Chapters & Marketplace', status: 'IMPLEMENTED', notes: 'CRUD and membership flows available.' },
    ],
  },
  {
    key: 'admin-analytics',
    name: 'Admin & Analytics',
    status: 'PARTIAL',
    risk: 'MEDIUM',
    owner: 'Admin Ops',
    features: [
      { key: 'admin-dashboard', name: 'Admin Dashboard Metrics', status: 'IMPLEMENTED', notes: 'Cross-domain stats endpoint available.' },
      { key: 'audit-logs', name: 'Audit Log Operations', status: 'IMPLEMENTED', notes: 'Audit query endpoints available.' },
      { key: 'release-readiness', name: 'Release Readiness Controls', status: 'PARTIAL', notes: 'Control-plane coverage expanding in this release.' },
    ],
  },
];

