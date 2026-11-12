/**
 * ROUND 3 / A4 - `POST /gallery/albums/:albumId/photos` stored the file first and validated the caption afterwards, so any
 * member of the batch could leave files on disk that no record points to (and fill the disk) by sending a caption that fails
 * validation (a repeated multipart field is an array, so "caption must be text").
 */
import fs from 'fs';
import path from 'path';
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const galleryDir = path.join(process.cwd(), 'uploads', 'gallery');
const listing = () => (fs.existsSync(galleryDir) ? new Set(fs.readdirSync(galleryDir)) : new Set<string>());
const created: string[] = [];
afterEach(() => {
  // never leave test files in the shared uploads folder, whatever the outcome
  for (const name of listing()) if (created.includes(name)) fs.rmSync(path.join(galleryDir, name), { force: true });
});
const newFilesSince = (before: Set<string>) => {
  const fresh = [...listing()].filter((name) => !before.has(name));
  created.push(...fresh);
  return fresh;
};

describe('R3-09 the caption is validated before anything is written to storage', () => {
  it('a caption that fails validation leaves no file behind and no photo row', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r3 orphan', albumType: 'BATCH', batchYear: member.user.batchYear } });
    const before = listing();

    // a repeated multipart field arrives as an array
    const res = await http()
      .post(`/api/gallery/albums/${album.id}/photos`)
      .set('Authorization', member.auth)
      .field('caption', 'first')
      .field('caption', 'second')
      .attach('photos', png, 'a.png')
      .attach('photos', png, 'b.png');

    expect(res.status).toBe(400);
    expect(newFilesSince(before)).toEqual([]);
    expect(await prisma.galleryPhoto.count({ where: { albumId: album.id } })).toBe(0);
  });

  it('control: a valid caption still stores every file and records it once', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r3 ok', albumType: 'BATCH', batchYear: member.user.batchYear } });
    const before = listing();
    const res = await http()
      .post(`/api/gallery/albums/${album.id}/photos`)
      .set('Authorization', member.auth)
      .field('caption', 'reunion')
      .attach('photos', png, 'a.png')
      .attach('photos', png, 'b.png');
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    expect(newFilesSince(before)).toHaveLength(2);
    expect(await prisma.galleryPhoto.count({ where: { albumId: album.id } })).toBe(2);
  });

  it('a member who may not add to the album stores nothing (the permission check also comes first)', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r3 other batch', albumType: 'BATCH', batchYear: member.user.batchYear + 1 } });
    const before = listing();
    const res = await http().post(`/api/gallery/albums/${album.id}/photos`).set('Authorization', member.auth).attach('photos', png, 'a.png');
    expect(res.status).toBe(403);
    expect(newFilesSince(before)).toEqual([]);
  });

  it('when recording the photo fails after the file was stored, the file is removed again', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r3 vanishing', albumType: 'BATCH', batchYear: member.user.batchYear } });
    const { galleryService } = await import('../../../src/services/galleryService');
    const spy = jest.spyOn(galleryService, 'addPhoto').mockRejectedValue(new Error('database went away'));
    const before = listing();
    try {
      const res = await http().post(`/api/gallery/albums/${album.id}/photos`).set('Authorization', member.auth).attach('photos', png, 'a.png');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(newFilesSince(before)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
