/**
 * The college alumni list against a real PostgreSQL database: import -> match -> bulk approve.
 *
 * An administrator imports the list the college keeps; the review queue then says, per registration, whether the
 * person is on it (exact / probable / none), can be filtered and worked in bulk, and the records stay out of reach of
 * everybody but administrators.
 */
import * as email from '../../src/utils/email';
import { http, prisma, createUser, PASSWORD } from './helpers';

const spy = <K extends keyof typeof email>(name: K) =>
  jest.spyOn(email, name as any).mockResolvedValue(undefined as never) as unknown as jest.Mock;

beforeEach(() => {
  spy('sendWelcomeEmail');
  spy('sendRejectionEmail');
  spy('sendEmail');
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Every test works with its own tag, so names and numbers never meet another suite's rows. */
let counter = 0;
const tagged = () => `${Date.now().toString(36)}${++counter}`.toUpperCase();

const applicant = (over: Record<string, unknown> = {}) =>
  createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, batchYear: 2015, department: 'Computer Engineering', ...over });

describe('the college alumni list', () => {
  it('is for administrators only', async () => {
    const member = await createUser('MEMBER');
    const chapterAdmin = await createUser('CHAPTER_ADMIN');
    const rows = [{ fullName: 'Nobody Here', batchYear: 2015 }];
    for (const user of [member, chapterAdmin]) {
      expect((await http().post('/api/admin/alumni-records/import').set('Authorization', user.auth).send({ rows })).status).toBe(403);
      expect((await http().get('/api/admin/alumni-records').set('Authorization', user.auth)).status).toBe(403);
    }
    expect((await http().get('/api/admin/alumni-records')).status).toBe(401);
    expect(await prisma.alumniRecord.count({ where: { fullName: 'Nobody Here' } })).toBe(0);
  });

  it('imports, upserts by the normalised enrolment number, reports bad rows and never duplicates on a second import', async () => {
    const admin = await createUser('ADMIN');
    const tag = tagged();
    const rows = [
      { fullName: `  Ada   Alum${tag} `, batchYear: 2015, department: 'Computer Engineering', enrollmentNumber: ` ${tag.toLowerCase()} 001 ` },
      { fullName: `Ben Batch${tag}`, batchYear: '2016', enrollmentNumber: `${tag}002` },
      { fullName: `No Number${tag}`, batchYear: 2017, department: 'Civil' },
      { fullName: 'X', batchYear: 2015 },
      { fullName: `Dup${tag}`, batchYear: 2015, enrollmentNumber: `${tag}001` },
    ];
    const first = await http().post('/api/admin/alumni-records/import').set('Authorization', admin.auth).send({ rows });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      created: 3,
      updated: 0,
      skipped: 2,
      errors: [
        { row: 4, message: expect.any(String) },
        { row: 5, message: expect.stringMatching(/row 1/) },
      ],
    });

    // stored normalised: trimmed, upper-cased, no spaces
    const stored = await prisma.alumniRecord.findUnique({ where: { enrollmentNumber: `${tag}001` } });
    expect(stored).toMatchObject({ fullName: `Ada Alum${tag}`, batchYear: 2015, importedById: admin.user.id });

    // the same file again changes nothing; a changed row updates
    const second = await http().post('/api/admin/alumni-records/import').set('Authorization', admin.auth).send({
      rows: [rows[0], rows[1], rows[2]],
    });
    expect(second.body.data).toMatchObject({ created: 0, updated: 0, skipped: 3 });
    const third = await http().post('/api/admin/alumni-records/import').set('Authorization', admin.auth).send({
      rows: [{ fullName: `Ben Batch${tag}`, batchYear: 2016, department: 'Electrical', enrollmentNumber: `${tag}002` }],
    });
    expect(third.body.data).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(await prisma.alumniRecord.count({ where: { OR: [{ fullName: { contains: tag } }] } })).toBe(3);

    // the import is audited with counts only
    const audit = await prisma.auditLog.findFirst({ where: { userId: admin.user.id, action: 'IMPORT', entityType: 'ALUMNI_RECORD' }, orderBy: { createdAt: 'asc' } });
    expect(audit?.newValues).toEqual({ rows: 5, created: 3, updated: 0, skipped: 2 });
    expect(JSON.stringify(audit)).not.toContain(tag);

    // searchable (enrolment number matched the way it is stored), paged, newest batch first
    const found = await http().get('/api/admin/alumni-records').set('Authorization', admin.auth).query({ search: tag.toLowerCase(), limit: 2 });
    expect(found.status).toBe(200);
    expect(found.body.pagination).toMatchObject({ total: 3, limit: 2 });
    expect(found.body.data.map((r: { batchYear: number }) => r.batchYear)).toEqual([2017, 2016]);
    expect(found.body.data[0]).not.toHaveProperty('nameKey');
  });

  it('import -> match -> bulk approve: exact matches are approved together, the rest is reported per id', async () => {
    const admin = await createUser('ADMIN');
    const tag = tagged();
    await http()
      .post('/api/admin/alumni-records/import')
      .set('Authorization', admin.auth)
      .send({
        rows: [
          { fullName: `Zoë Müller ${tag}`, batchYear: 2015, department: 'Computer Engineering', enrollmentNumber: `${tag}-A` },
          { fullName: `José Álvarez ${tag}`, batchYear: 2015, department: 'Civil', enrollmentNumber: `${tag}-B` },
          { fullName: `Probable Person ${tag}`, batchYear: 2015, department: 'Civil' },
          { fullName: `Wrong Batch ${tag}`, batchYear: 2012, department: 'Civil', enrollmentNumber: `${tag}-D` },
          { fullName: `Somebody Real ${tag}`, batchYear: 2015, enrollmentNumber: `${tag}-E` },
        ],
      })
      .expect(200);

    const exactA = await applicant({ fullName: `zoe   muller ${tag}`, enrollmentNumber: ` ${tag.toLowerCase()}-a `, createdAt: new Date(Date.now() - 9 * 86_400_000) });
    const exactB = await applicant({ fullName: `JOSE ALVAREZ ${tag}`, enrollmentNumber: `${tag}-B` });
    const probable = await applicant({ fullName: `Probable   Person ${tag}`, enrollmentNumber: null });
    const nameDiffers = await applicant({ fullName: `Typed Another Number ${tag}`, enrollmentNumber: `${tag}-E` });
    const wrongBatch = await applicant({ fullName: `Wrong Batch ${tag}`, enrollmentNumber: `${tag}-D` });
    const stranger = await applicant({ fullName: `Stranger ${tag}`, enrollmentNumber: null });

    const queue = await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ search: tag, limit: 50 });
    expect(queue.status).toBe(200);
    const byId = new Map<string, any>(queue.body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(exactA.user.id).match).toMatchObject({ level: 'exact', record: { batchYear: 2015, department: 'Computer Engineering' } });
    expect(byId.get(exactB.user.id).match.level).toBe('exact');
    expect(byId.get(probable.user.id).match.level).toBe('probable');
    expect(byId.get(nameDiffers.user.id).match).toMatchObject({ level: 'probable', reason: expect.stringMatching(/name differs/i) });
    expect(byId.get(wrongBatch.user.id).match.level).toBe('none');
    expect(byId.get(stranger.user.id).match.level).toBe('none');
    // the list never shows another person's record: no name, no number
    expect(JSON.stringify(queue.body)).not.toMatch(/nameKey|"recordName"/);
    expect(byId.get(exactA.user.id).waitingDays).toBe(9);

    // filters: match, batch, department, waiting
    const only = async (query: Record<string, unknown>) =>
      (await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ search: tag, limit: 50, ...query })).body;
    const exact = await only({ match: 'exact' });
    expect(exact.data.map((r: { id: string }) => r.id).sort()).toEqual([exactA.user.id, exactB.user.id].sort());
    expect(exact.pagination.total).toBe(2);
    expect((await only({ match: 'exact', limit: 1, page: 2 })).data).toHaveLength(1);
    expect((await only({ match: 'probable' })).pagination.total).toBe(2);
    expect((await only({ match: 'none' })).pagination.total).toBe(2);
    expect((await only({ waitingDays: 7 })).data.map((r: { id: string }) => r.id)).toEqual([exactA.user.id]);
    expect((await only({ batchYear: 2016 })).data).toEqual([]);
    expect((await only({ department: 'computer engineering' })).pagination.total).toBe(6);
    expect((await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ match: 'maybe' })).status).toBe(400);

    // bulk approve: the two exact matches, one that was never there, one that is already approved
    const already = await createUser('MEMBER', { fullName: `Already ${tag}` });
    const missing = '00000000-0000-4000-8000-0000000000aa';
    const bulk = await http()
      .post('/api/admin/approvals/bulk-approve')
      .set('Authorization', admin.auth)
      .send({ ids: [exactA.user.id, missing, exactB.user.id, already.user.id], note: 'Matched the college list' });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data).toEqual({
      succeeded: 2,
      failed: 2,
      results: [
        { id: exactA.user.id, ok: true },
        { id: missing, ok: false, code: 'NOT_FOUND', message: expect.any(String) },
        { id: exactB.user.id, ok: true },
        { id: already.user.id, ok: false, code: 'ALREADY_APPROVED', message: expect.any(String) },
      ],
    });
    expect(JSON.stringify(bulk.body)).not.toContain(tag);

    for (const person of [exactA, exactB]) {
      expect(await prisma.user.findUnique({ where: { id: person.user.id } })).toMatchObject({
        approvalStatus: 'APPROVED',
        isVerified: true,
        approvalReviewedById: admin.user.id,
        approvalNote: 'Matched the college list',
      });
      expect(await prisma.auditLog.count({ where: { userId: admin.user.id, action: 'APPROVE', entityId: person.user.id } })).toBe(1);
    }
    expect(await prisma.user.findUnique({ where: { id: probable.user.id }, select: { approvalStatus: true } })).toEqual({ approvalStatus: 'PENDING' });

    // the same request again: nothing happens twice
    const again = await http().post('/api/admin/approvals/bulk-approve').set('Authorization', admin.auth).send({ ids: [exactA.user.id] });
    expect(again.body.data.results[0]).toMatchObject({ ok: false, code: 'ALREADY_APPROVED' });
    expect(await prisma.auditLog.count({ where: { action: 'APPROVE', entityId: exactA.user.id } })).toBe(1);

    // bulk reject always needs a reason
    const noReason = await http().post('/api/admin/approvals/bulk-reject').set('Authorization', admin.auth).send({ ids: [wrongBatch.user.id, stranger.user.id] });
    expect(noReason.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: wrongBatch.user.id }, select: { approvalStatus: true } })).toEqual({ approvalStatus: 'PENDING' });
    const rejected = await http()
      .post('/api/admin/approvals/bulk-reject')
      .set('Authorization', admin.auth)
      .send({ ids: [wrongBatch.user.id, stranger.user.id, exactA.user.id], reason: 'We could not find you on the college list.' });
    expect(rejected.body.data).toMatchObject({ succeeded: 2, failed: 1 });
    expect(rejected.body.data.results[2]).toMatchObject({ id: exactA.user.id, ok: false, code: 'NOT_PENDING' });
    expect(await prisma.user.findUnique({ where: { id: stranger.user.id } })).toMatchObject({
      approvalStatus: 'REJECTED',
      approvalNote: 'We could not find you on the college list.',
    });

    // more than 50 ids is refused before anything happens
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await http().post('/api/admin/approvals/bulk-approve').set('Authorization', admin.auth).send({ ids: many })).status).toBe(400);

    // the summary counts what has waited a week
    const summary = await http().get('/api/admin/approvals/summary').set('Authorization', admin.auth);
    expect(summary.body.data.overdue).toBeGreaterThanOrEqual(0);
    expect(summary.body.data.alumniRecords).toBeGreaterThanOrEqual(5);
  });

  it('removing a record takes the match away, is audited without the name, and answers 404 the second time', async () => {
    const admin = await createUser('ADMIN');
    const tag = tagged();
    await http().post('/api/admin/alumni-records/import').set('Authorization', admin.auth).send({ rows: [{ fullName: `Removable ${tag}`, batchYear: 2015, enrollmentNumber: `${tag}-R` }] }).expect(200);
    await applicant({ fullName: `Removable ${tag}`, enrollmentNumber: `${tag}-R` });
    const level = async () => (await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ search: tag })).body.data[0].match.level;
    expect(await level()).toBe('exact');

    const record = await prisma.alumniRecord.findUniqueOrThrow({ where: { enrollmentNumber: `${tag}-R` } });
    const member = await createUser('MEMBER');
    expect((await http().delete(`/api/admin/alumni-records/${record.id}`).set('Authorization', member.auth)).status).toBe(403);
    expect((await http().delete(`/api/admin/alumni-records/${record.id}`).set('Authorization', admin.auth)).status).toBe(200);
    expect(await level()).toBe('none');
    expect((await http().delete(`/api/admin/alumni-records/${record.id}`).set('Authorization', admin.auth)).status).toBe(404);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'DELETE', entityType: 'ALUMNI_RECORD', entityId: record.id } });
    expect(audit).toMatchObject({ userId: admin.user.id });
    expect(JSON.stringify(audit)).not.toContain(tag);
  });

  it('deleting the administrator who imported a record keeps the record and lets go of the pointer', async () => {
    const admin = await createUser('ADMIN');
    const tag = tagged();
    await http().post('/api/admin/alumni-records/import').set('Authorization', admin.auth).send({ rows: [{ fullName: `Kept ${tag}`, batchYear: 2015, enrollmentNumber: `${tag}-K` }] }).expect(200);
    expect((await prisma.alumniRecord.findUniqueOrThrow({ where: { enrollmentNumber: `${tag}-K` } })).importedById).toBe(admin.user.id);

    expect((await http().delete('/api/users/me').set('Authorization', admin.auth).send({ password: PASSWORD })).status).toBe(200);
    expect(await prisma.alumniRecord.findUniqueOrThrow({ where: { enrollmentNumber: `${tag}-K` } })).toMatchObject({ importedById: null, fullName: `Kept ${tag}` });
  });
});
