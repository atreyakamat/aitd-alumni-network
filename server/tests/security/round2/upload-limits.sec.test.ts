/**
 * ROUND 2 - multipart bodies are bounded in more than the file size. multer buffers every TEXT field in memory, and its
 * defaults put no bound on how many there are, so any registered member could hold the process's memory with one request.
 */
import fs from 'fs';
import path from 'path';
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stored: string[] = [];
afterAll(() => {
  for (const url of stored) fs.rmSync(path.join(process.cwd(), url.replace(/^\//, '')), { force: true });
});

describe('R2-17 multipart text fields are limited in count and size', () => {
  it('refuses a request with hundreds of text fields', async () => {
    const member = await createUser('MEMBER');
    let req = http().post('/api/posts/media').set('Authorization', member.auth);
    for (let i = 0; i < 300; i++) req = req.field(`f${i}`, 'x');
    const res = await req.attach('media', png, 'a.png');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('refuses one oversized text field', async () => {
    const member = await createUser('MEMBER');
    const res = await http().post('/api/posts/media').set('Authorization', member.auth).field('caption', 'x'.repeat(200 * 1024)).attach('media', png, 'a.png');
    expect(res.status).toBe(400);
  });

  it('refuses the same on the other upload routes', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r2 limits', albumType: 'BATCH', batchYear: member.user.batchYear } });
    for (const [method, url, field] of [
      ['post', `/api/gallery/albums/${album.id}/photos`, 'photos'],
      ['patch', '/api/users/profile-photo', 'photo'],
      ['patch', '/api/users/cover-photo', 'photo'],
    ] as const) {
      let req = http()[method](url).set('Authorization', member.auth);
      for (let i = 0; i < 300; i++) req = req.field(`f${i}`, 'x');
      const res = await req.attach(field, png, 'a.png');
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }
  });

  it('still accepts an ordinary upload with a caption', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r2 ok', albumType: 'BATCH', batchYear: member.user.batchYear } });
    const res = await http().post(`/api/gallery/albums/${album.id}/photos`).set('Authorization', member.auth).field('caption', 'A normal caption').attach('photos', png, 'a.png');
    for (const photo of res.body?.data ?? []) stored.push(photo.url);
    expect(res.status).toBe(201);
    expect(res.body.data[0].caption).toBe('A normal caption');
  });
});
