jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { reportService, REPORT_DETAILS_MAX } from '../../services/reportService';
import { notificationService } from '../../services/notificationService';
import { postService } from '../../services/postService';
import { prismaMock } from '../../../tests/helpers';
import { arrangeViewer, commentRow, OTHER, OWNER, postRow } from '../../../tests/helpers/social';

const createNotification = notificationService.createNotification as jest.Mock;
const ADMIN = { id: 'admin', userRole: 'ADMIN' };

beforeEach(() => {
  createNotification.mockClear();
  arrangeViewer(OTHER);
});

describe('reportService.report', () => {
  beforeEach(() => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ content: 'buy now!!' }));
    prismaMock.contentReport.findFirst.mockResolvedValue(null);
    prismaMock.contentReport.count.mockResolvedValue(0);
    prismaMock.contentReport.create.mockResolvedValue({ id: 'r1', status: 'OPEN' });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin1' }, { id: 'admin2' }]);
  });

  it('files a post report with a snapshot and alerts admins on the first report', async () => {
    await expect(
      reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'spam', details: '  ads  ' })
    ).resolves.toEqual({ id: 'r1', status: 'OPEN' });

    expect(prismaMock.contentReport.create).toHaveBeenCalledWith({
      data: { postId: 'p1', reporterId: OTHER, reason: 'SPAM', details: 'ads', contentSnapshot: 'buy now!!' },
      select: { id: true, status: true },
    });
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({ isActive: true, userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } });
    expect(createNotification.mock.calls.map((c) => [c[0].userId, c[0].type, c[0].link])).toEqual([
      ['admin1', 'CONTENT_REPORTED', '/admin/reports'],
      ['admin2', 'CONTENT_REPORTED', '/admin/reports'],
    ]);
  });

  it('does not alert admins again while the item already has open reports', async () => {
    prismaMock.contentReport.count.mockResolvedValue(2);
    await reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'OTHER' });
    expect(prismaMock.contentReport.create.mock.calls[0][0].data.details).toBeNull();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('files a comment report', async () => {
    prismaMock.postComment.findUnique.mockResolvedValue({ ...commentRow({ userId: OWNER, content: 'rude' }), post: postRow() });
    prismaMock.user.findMany.mockResolvedValue(undefined);
    await reportService.report({ id: OTHER }, { kind: 'comment', id: 'c1' }, { reason: 'HARASSMENT' });
    expect(prismaMock.contentReport.create.mock.calls[0][0].data).toMatchObject({ commentId: 'c1', contentSnapshot: 'rude' });
  });

  it('409s on a second open report by the same member', async () => {
    prismaMock.contentReport.findFirst.mockResolvedValue({ id: 'old' });
    await expect(reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'SPAM' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_REPORTED',
    });
  });

  it('rejects reports of your own content, invalid input and invisible items', async () => {
    arrangeViewer(OWNER);
    await expect(reportService.report({ id: OWNER }, { kind: 'post', id: 'p1' }, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'CANNOT_REPORT_OWN' });

    arrangeViewer(OTHER);
    await expect(reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'BORING' })).rejects.toMatchObject({ code: 'INVALID_REASON' });
    await expect(reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'SPAM', details: 5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'SPAM', details: 'x'.repeat(REPORT_DETAILS_MAX + 1) })
    ).rejects.toMatchObject({ statusCode: 400 });

    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(reportService.report({ id: OTHER }, { kind: 'post', id: 'p1' }, { reason: 'SPAM' })).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.postComment.findUnique.mockResolvedValue(null);
    await expect(reportService.report({ id: OTHER }, { kind: 'comment', id: 'c1' }, { reason: 'SPAM' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.contentReport.create).not.toHaveBeenCalled();
  });
});

describe('reportService.list', () => {
  const report = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    postId: 'p1',
    commentId: null,
    reason: 'SPAM',
    details: null,
    status: 'OPEN',
    contentSnapshot: 'buy now',
    createdAt: new Date(),
    reporter: { id: OTHER },
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    ...overrides,
  });

  it('groups open reports per item with a count and the presented content', async () => {
    arrangeViewer('admin');
    prismaMock.contentReport.findMany.mockResolvedValue([
      report({ id: 'r3' }),
      report({ id: 'r2' }),
      report({ id: 'r1', postId: null, commentId: 'c1' }),
    ]);
    prismaMock.post.findMany.mockResolvedValue([postRow()]);
    prismaMock.postComment.findMany.mockResolvedValue([commentRow()]);

    const result = await reportService.list(ADMIN, {});

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 'r3', reportCount: 2, post: { id: 'p1' }, comment: null });
    expect(result.items[1]).toMatchObject({ id: 'r1', reportCount: 1, post: null, comment: { id: 'c1' } });
    expect(result.nextCursor).toBeNull();
  });

  it('lists closed reports one by one, newest resolution first', async () => {
    prismaMock.contentReport.findMany.mockResolvedValue([report({ status: 'RESOLVED', postId: 'gone', resolution: 'removed' })]);
    prismaMock.post.findMany.mockResolvedValue([]);

    const result = await reportService.list(ADMIN, { status: 'resolved' });

    expect(prismaMock.contentReport.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'RESOLVED' }, orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }] });
    expect(result.items[0]).toMatchObject({ reportCount: 1, post: null, resolution: 'removed' });
  });

  it('tolerates empty lookups and rejects unknown statuses', async () => {
    prismaMock.contentReport.findMany.mockResolvedValue(undefined);
    await expect(reportService.list(ADMIN, { status: 'DISMISSED' })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(reportService.list(ADMIN, { status: 'OPEN' })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(reportService.list(ADMIN, { status: 'LOST' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('reportService.resolve', () => {
  const openReport = { id: 'r1', postId: 'p1', commentId: null, reason: 'SPAM', status: 'OPEN', contentSnapshot: 'buy' };

  beforeEach(() => {
    prismaMock.contentReport.findUnique.mockResolvedValue(openReport);
    prismaMock.contentReport.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it('dismisses every open report on the item and audits it', async () => {
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'DISMISS', note: ' fine ' })).resolves.toEqual({
      id: 'r1',
      status: 'DISMISSED',
      reportsClosed: 2,
    });
    expect(prismaMock.contentReport.updateMany.mock.calls[0][0]).toMatchObject({
      where: { postId: 'p1', status: 'OPEN' },
      data: { status: 'DISMISSED', resolvedById: 'admin', resolution: 'fine' },
    });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'REPORT_DISMISSED', entityType: 'POST', entityId: 'p1' });
  });

  it('removes a reported post or comment, then audits CONTENT_REMOVED', async () => {
    const deletePost = jest.spyOn(postService, 'deletePost').mockResolvedValue({ message: 'ok' });
    const deleteComment = jest.spyOn(postService, 'deleteComment').mockResolvedValue({ message: 'ok' });

    await expect(reportService.resolve(ADMIN, 'r1', { action: 'REMOVE_CONTENT' })).resolves.toMatchObject({ status: 'RESOLVED' });
    expect(deletePost).toHaveBeenCalledWith('admin', 'p1', true);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CONTENT_REMOVED', entityType: 'POST' });

    prismaMock.contentReport.findUnique.mockResolvedValue({ ...openReport, postId: null, commentId: 'c1' });
    prismaMock.contentReport.updateMany.mockResolvedValue(undefined);
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'REMOVE_CONTENT' })).resolves.toMatchObject({ reportsClosed: 0 });
    expect(deleteComment).toHaveBeenCalledWith('admin', 'c1', true);
    expect(prismaMock.contentReport.updateMany.mock.calls[1][0].where).toEqual({ commentId: 'c1', status: 'OPEN' });
    deletePost.mockRestore();
    deleteComment.mockRestore();
  });

  it('rejects bad actions/notes, missing or closed reports and reports whose content is gone', async () => {
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'BAN' })).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    await expect(reportService.resolve(ADMIN, 'r1', undefined as any)).rejects.toMatchObject({ statusCode: 400 });
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'DISMISS', note: 4 })).rejects.toMatchObject({ statusCode: 400 });

    prismaMock.contentReport.findUnique.mockResolvedValue(null);
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'DISMISS' })).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.contentReport.findUnique.mockResolvedValue({ ...openReport, status: 'RESOLVED' });
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'DISMISS' })).rejects.toMatchObject({ code: 'REPORT_CLOSED' });
    prismaMock.contentReport.findUnique.mockResolvedValue({ ...openReport, postId: null });
    await expect(reportService.resolve(ADMIN, 'r1', { action: 'DISMISS' })).rejects.toMatchObject({ code: 'CONTENT_GONE' });
    expect(prismaMock.contentReport.updateMany).not.toHaveBeenCalled();
  });
});
