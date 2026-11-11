/**
 * The numbers behind the admin dashboard and analytics pages (`GET /api/admin/stats`, `response.data.data`).
 *
 * The response is read through `normalizeAdminStats` so a missing section, a field a newer or older server does not send,
 * or a value of the wrong type becomes a zero or an empty list, and never a crash ("Cannot read properties of undefined")
 * on a screen the administrators depend on.
 *
 * Since registrations need approval, every `users.*` figure counts APPROVED members only; people waiting for a decision
 * are `users.pendingApproval`, people turned down `users.rejected`.
 */
import { roleLabel } from '@/lib/roles';
import type { ApprovalStatus } from '@/lib/api';

export interface CountRow {
  count: number;
}

export interface RecentRegistration {
  id: string;
  fullName: string;
  email: string;
  batchYear: number | null;
  createdAt: string;
  /** Absent when the server does not send it (older servers): no badge is shown then. */
  approvalStatus?: ApprovalStatus;
}

export interface RecentPost {
  id: string;
  author: string;
  content: string;
  likes: number;
  comments: number;
  createdAt: string;
}

export interface MonthlyRevenue {
  month: string;
  donations: number;
  memberships: number;
}

export interface AdminStats {
  users: {
    /** Approved, active members. */
    total: number;
    /** Approved members who signed in during the last 30 days. */
    active: number;
    verified: number;
    newThisMonth: number;
    /** New members compared with last month, in percent; null when the server did not say. */
    growthPercent: number | null;
    pendingApproval: number;
    rejected: number;
    byRole: Array<{ role: string; count: number }>;
    byBatch: Array<{ year: number | null; count: number }>;
    byLocation: Array<{ city: string; count: number }>;
    monthlyGrowth: Array<{ month: string; count: number }>;
  };
  content: {
    posts: { total: number; thisMonth: number };
    comments: { total: number; thisMonth: number };
    jobs: { total: number; active: number; newThisMonth: number };
    events: { total: number; upcoming: number; newThisMonth: number };
  };
  financial: {
    donations: {
      totalAmount: number;
      totalCount: number;
      thisMonth: number;
      lastMonth: number;
      growthPercent: number | null;
      thisYear: number;
      monthly: MonthlyRevenue[];
    };
    memberships: { total: number; active: number };
  };
  engagement: {
    connections: number;
    messages: { total: number; thisMonth: number };
    daily: Array<{ day: string; posts: number; comments: number; messages: number }>;
  };
  recentActivity: {
    users: RecentRegistration[];
    posts: RecentPost[];
  };
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const dict = (value: unknown): Dict => (isDict(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const APPROVAL: readonly string[] = ['PENDING', 'APPROVED', 'REJECTED'];

export function normalizeAdminStats(raw: unknown): AdminStats {
  const root = dict(raw);
  const users = dict(root.users);
  const content = dict(root.content);
  const financial = dict(root.financial);
  const donations = dict(financial.donations);
  const memberships = dict(financial.memberships);
  const engagement = dict(root.engagement);
  const messages = dict(engagement.messages);
  const recent = dict(root.recentActivity);

  const pair = (value: unknown, keys: string[]) => {
    const d = dict(value);
    return Object.fromEntries(keys.map((k) => [k, num(d[k])]));
  };
  // `comments` was once a bare number
  const comments = isDict(content.comments) ? pair(content.comments, ['total', 'thisMonth']) : { total: num(content.comments), thisMonth: 0 };

  return {
    users: {
      total: num(users.total),
      active: num(users.active),
      verified: num(users.verified),
      newThisMonth: num(users.newThisMonth),
      growthPercent: numOrNull(users.growthPercent),
      pendingApproval: num(users.pendingApproval),
      rejected: num(users.rejected),
      byRole: list(users.byRole)
        .filter(isDict)
        .map((r) => ({ role: text(r.role, 'MEMBER'), count: num(r.count) })),
      byBatch: list(users.byBatch)
        .filter(isDict)
        .map((b) => ({ year: numOrNull(b.year), count: num(b.count) })),
      byLocation: list(users.byLocation)
        .filter(isDict)
        .map((l) => ({ city: text(l.city, 'Unknown'), count: num(l.count) })),
      monthlyGrowth: list(users.monthlyGrowth)
        .filter(isDict)
        .map((m) => ({ month: text(m.month), count: num(m.count) })),
    },
    content: {
      posts: pair(content.posts, ['total', 'thisMonth']) as AdminStats['content']['posts'],
      comments: comments as AdminStats['content']['comments'],
      jobs: pair(content.jobs, ['total', 'active', 'newThisMonth']) as AdminStats['content']['jobs'],
      events: pair(content.events, ['total', 'upcoming', 'newThisMonth']) as AdminStats['content']['events'],
    },
    financial: {
      donations: {
        totalAmount: num(donations.totalAmount),
        totalCount: num(donations.totalCount),
        thisMonth: num(donations.thisMonth),
        lastMonth: num(donations.lastMonth),
        growthPercent: numOrNull(donations.growthPercent),
        thisYear: num(donations.thisYear),
        monthly: list(donations.monthly)
          .filter(isDict)
          .map((m) => ({ month: text(m.month), donations: num(m.donations), memberships: num(m.memberships) })),
      },
      memberships: { total: num(memberships.total), active: num(memberships.active) },
    },
    engagement: {
      connections: num(engagement.connections),
      messages: { total: num(messages.total), thisMonth: num(messages.thisMonth) },
      daily: list(engagement.daily)
        .filter(isDict)
        .map((d) => ({ day: text(d.day), posts: num(d.posts), comments: num(d.comments), messages: num(d.messages) })),
    },
    recentActivity: {
      users: list(recent.users)
        .filter(isDict)
        .filter((u) => typeof u.id === 'string' && u.id !== '')
        .map((u) => ({
          id: u.id as string,
          fullName: text(u.fullName),
          email: text(u.email),
          batchYear: numOrNull(u.batchYear),
          createdAt: text(u.createdAt),
          approvalStatus: APPROVAL.includes(u.approvalStatus as string) ? (u.approvalStatus as ApprovalStatus) : undefined,
        })),
      posts: list(recent.posts)
        .filter(isDict)
        .map((p, index) => ({
          id: text(p.id, `post-${index}`),
          author: text(p.author, '') || 'Unknown',
          content: text(p.content),
          likes: num(p.likes),
          comments: num(p.comments),
          createdAt: text(p.createdAt),
        })),
    },
  };
}

export interface RoleSlice {
  /** "Member", "Chapter Admin", ... */
  name: string;
  role: string;
  value: number;
  /** Whole percent of all members. */
  percent: number;
}

/** The role split with people-friendly names and shares, empty roles left out. */
export function roleChartData(byRole: Array<{ role: string; count: number }>): RoleSlice[] {
  const rows = byRole.filter((r) => r.count > 0);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({
    name: roleLabel(r.role),
    role: r.role,
    value: r.count,
    percent: total > 0 ? Math.round((r.count / total) * 100) : 0,
  }));
}

/** Whether any month shows any money, i.e. whether a revenue chart has something to draw. */
export function hasAnyRevenue(monthly: ReadonlyArray<Partial<MonthlyRevenue>>): boolean {
  return monthly.some((m) => num(m.donations) > 0 || num(m.memberships) > 0);
}
