import { describe, expect, it } from 'vitest';
import { normalizeAdminStats, roleChartData, hasAnyRevenue } from '@/lib/admin-stats';

describe('normalizeAdminStats', () => {
  it('turns nothing at all into zeros and empty lists, so no page can crash on a missing section', () => {
    for (const raw of [undefined, null, {}, 'oops', { users: null }]) {
      const s = normalizeAdminStats(raw);
      expect(s.users.total).toBe(0);
      expect(s.users.pendingApproval).toBe(0);
      expect(s.users.rejected).toBe(0);
      expect(s.users.growthPercent).toBeNull();
      expect(s.users.byRole).toEqual([]);
      expect(s.content.events).toEqual({ total: 0, upcoming: 0, newThisMonth: 0 });
      expect(s.financial.donations.monthly).toEqual([]);
      expect(s.engagement.daily).toEqual([]);
      expect(s.recentActivity.users).toEqual([]);
      expect(s.recentActivity.posts).toEqual([]);
    }
  });

  it('keeps the real numbers and the new pending/rejected counts', () => {
    const s = normalizeAdminStats({
      users: { total: 26, active: 20, verified: 26, newThisMonth: 8, growthPercent: -26.7, pendingApproval: 3, rejected: 1 },
      content: { posts: { total: 10, thisMonth: 2 }, comments: { total: 33, thisMonth: 4 }, events: { total: 6, upcoming: 1, newThisMonth: 1 } },
      financial: { donations: { totalAmount: '5000', thisMonth: 300, growthPercent: 50, monthly: [{ month: 'Oct 26', donations: 1, memberships: 2 }] } },
      engagement: { connections: 7, messages: { total: 40, thisMonth: 5 } },
    });
    expect(s.users).toMatchObject({ total: 26, active: 20, newThisMonth: 8, growthPercent: -26.7, pendingApproval: 3, rejected: 1 });
    expect(s.content.posts).toEqual({ total: 10, thisMonth: 2 });
    expect(s.content.comments.total).toBe(33);
    expect(s.content.jobs).toEqual({ total: 0, active: 0, newThisMonth: 0 });
    expect(s.financial.donations.totalAmount).toBe(5000);
    expect(s.financial.donations.monthly).toEqual([{ month: 'Oct 26', donations: 1, memberships: 2 }]);
    expect(s.engagement.messages).toEqual({ total: 40, thisMonth: 5 });
  });

  it('copes with a server that does not send pendingApproval or rejected yet: zero, never NaN or undefined', () => {
    const s = normalizeAdminStats({ users: { total: 5 } });
    expect(s.users.pendingApproval).toBe(0);
    expect(s.users.rejected).toBe(0);
    expect(normalizeAdminStats({ users: { pendingApproval: '4' } }).users.pendingApproval).toBe(4);
  });

  it('reads comments given as a plain number as well as an object', () => {
    expect(normalizeAdminStats({ content: { comments: 12 } }).content.comments).toEqual({ total: 12, thisMonth: 0 });
  });

  it('maps lists defensively', () => {
    const s = normalizeAdminStats({
      users: {
        byRole: [{ role: 'MEMBER', count: 22 }, { role: 'SUPER_ADMIN', count: 1 }, null],
        byBatch: [{ year: 2019, count: 4 }, { year: null, count: 1 }],
        byLocation: [{ city: 'Pune', count: 3 }],
        monthlyGrowth: [{ month: 'Nov 26', count: 2 }, { month: 'Dec 26' }],
      },
      engagement: { daily: [{ day: 'Mon', posts: 1, comments: 2, messages: 3 }] },
      recentActivity: {
        users: [
          { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@x.edu', batchYear: 2019, createdAt: '2026-11-09T10:00:00Z', approvalStatus: 'PENDING' },
          { id: 'u2', fullName: null, email: 'b@x.edu', createdAt: '2026-11-08T10:00:00Z', approvalStatus: 'weird' },
          { fullName: 'no id' },
        ],
        posts: [{ id: 'p1', author: null, content: 'Hi', likes: 2, comments: 1, createdAt: '2026-11-09T09:00:00Z' }],
      },
    });
    expect(s.users.byRole).toEqual([{ role: 'MEMBER', count: 22 }, { role: 'SUPER_ADMIN', count: 1 }]);
    expect(s.users.byBatch).toEqual([{ year: 2019, count: 4 }, { year: null, count: 1 }]);
    expect(s.users.monthlyGrowth).toEqual([{ month: 'Nov 26', count: 2 }, { month: 'Dec 26', count: 0 }]);
    expect(s.engagement.daily).toEqual([{ day: 'Mon', posts: 1, comments: 2, messages: 3 }]);
    expect(s.recentActivity.users).toHaveLength(2);
    expect(s.recentActivity.users[0]).toMatchObject({ id: 'u1', approvalStatus: 'PENDING' });
    // an unknown status is dropped rather than shown as something it is not
    expect(s.recentActivity.users[1]).toMatchObject({ id: 'u2', fullName: '', approvalStatus: undefined });
    expect(s.recentActivity.posts[0]).toMatchObject({ id: 'p1', author: 'Unknown', likes: 2, comments: 1 });
  });
});

describe('roleChartData', () => {
  it('uses people-friendly role names and the share of the total', () => {
    const data = roleChartData([
      { role: 'MEMBER', count: 22 },
      { role: 'CHAPTER_ADMIN', count: 1 },
      { role: 'ADMIN', count: 1 },
      { role: 'SUPER_ADMIN', count: 1 },
    ]);
    expect(data.map((d) => d.name)).toEqual(['Member', 'Chapter Admin', 'Admin', 'Super Admin']);
    expect(data[0]).toMatchObject({ value: 22, percent: 88 });
    expect(data.map((d) => d.name).join('')).not.toMatch(/_/);
  });

  it('drops empty roles and survives an empty list', () => {
    expect(roleChartData([{ role: 'MEMBER', count: 0 }])).toEqual([]);
    expect(roleChartData([])).toEqual([]);
  });
});

describe('hasAnyRevenue', () => {
  it('is false when every month is zero or there is nothing', () => {
    expect(hasAnyRevenue([])).toBe(false);
    expect(hasAnyRevenue([{ month: 'Nov 26', donations: 0, memberships: 0 }])).toBe(false);
  });
  it('is true as soon as one month has money', () => {
    expect(hasAnyRevenue([{ month: 'Nov 26', donations: 0, memberships: 0 }, { month: 'Dec 26', donations: 0, memberships: 100 }])).toBe(true);
  });
});
