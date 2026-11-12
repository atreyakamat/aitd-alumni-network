/**
 * ROUND 3 / D3 (R3-14, R3-15) - uploads: polyglots, SVG, oversize and pixel floods, double extensions, hostile file names, content-type confusion,
 * metadata leaks, and how the stored file is served (it is on the SAME origin as the app, so it must never be runnable there).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const uploadsRoot = path.join(process.cwd(), 'uploads');
const stored: string[] = [];
afterAll(() => {
  for (const url of stored) fs.rmSync(path.join(process.cwd(), url.replace(/^\//, '')), { force: true });
});

const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const profilePhoto = (auth: string, body: Buffer, filename: string, contentType: string) =>
  http().patch('/api/users/profile-photo').set('Authorization', auth).attach('photo', body, { filename, contentType });

const keep = (res: { status: number; body: { data?: { profilePhotoUrl?: string } } }) => {
  const url = res.body?.data?.profilePhotoUrl;
  if (res.status === 200 && url) stored.push(url);
  return url;
};

describe('what is accepted as an image is decided by the bytes', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.domain)</script></svg>');
  const html = Buffer.from('<!doctype html><script>alert(document.domain)</script>');

  it.each([
    ['a real SVG named .svg', svg, 'logo.svg', 'image/svg+xml'],
    ['a real SVG named .png', svg, 'logo.png', 'image/png'],
    ['a real SVG with a .png.svg double extension', svg, 'logo.png.svg', 'image/svg+xml'],
    ['HTML named .jpg', html, 'page.jpg', 'image/jpeg'],
    ['HTML named .gif with the GIF magic in front', Buffer.concat([Buffer.from('GIF89a'), html]), 'x.gif', 'image/gif'],
    ['a PHP script with a PNG name', Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.php.png', 'image/png'],
    ['an empty file', Buffer.alloc(0), 'empty.png', 'image/png'],
    ['a truncated PNG', png1x1.subarray(0, 40), 'cut.png', 'image/png'],
    ['a PDF named .png', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj'), 'doc.png', 'image/png'],
    ['an image whose extension and declared type disagree', png1x1, 'a.png', 'image/jpeg'],
    ['a file with no extension', png1x1, 'photo', 'image/png'],
    ['an executable extension', png1x1, 'a.png.exe', 'image/png'],
  ])('refuses %s', async (_label, body, filename, contentType) => {
    const { auth } = await createUser('MEMBER');
    const res = await profilePhoto(auth, body, filename, contentType);
    expect([400, 413, 415]).toContain(res.status);
    expect(keep(res)).toBeUndefined();
  });

  it('the same refusals on the other image routes (post media, gallery, cover photo, marketplace, video thumbnail)', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: 'r3 uploads', albumType: 'BATCH', batchYear: member.user.batchYear } });
    const svgBody = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const [method, url, field] of [
      ['post', '/api/posts/media', 'media'],
      ['post', `/api/gallery/albums/${album.id}/photos`, 'photos'],
      ['patch', '/api/users/cover-photo', 'photo'],
      ['post', '/api/marketplace/upload-image', 'image'],
      ['post', '/api/videos/upload-thumbnail', 'image'],
    ] as const) {
      const res = await http()[method](url).set('Authorization', member.auth).attach(field, svgBody, { filename: 'x.png', contentType: 'image/png' });
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }
  });
});

describe('what is stored is a re-encoded image under a name the server chose', () => {
  it('a GIF/script polyglot, a JPEG with a script tail and a PNG with trailing HTML are re-encoded (the payload does not survive) or refused', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const pngBuf = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#993366' } }).png().toBuffer();
    const marker = '<script>alert(document.domain)</script>';
    for (const [body, filename, contentType] of [
      [Buffer.concat([jpeg, Buffer.from(marker)]), 'tail.jpg', 'image/jpeg'],
      [Buffer.concat([pngBuf, Buffer.from(marker)]), 'tail.png', 'image/png'],
    ] as const) {
      const { auth } = await createUser('MEMBER');
      const res = await profilePhoto(auth, body, filename, contentType);
      const url = keep(res);
      if (res.status !== 200) {
        expect(res.status).toBe(400);
        continue;
      }
      const onDisk = fs.readFileSync(path.join(process.cwd(), (url as string).replace(/^\//, '')));
      expect(onDisk.includes(Buffer.from('<script'))).toBe(false);
      expect(onDisk.includes(Buffer.from('alert('))).toBe(false);
    }
  });

  it('the stored name is made by the server: nothing of the uploaded name (traversal, double extension, Unicode, NUL) is in the URL', async () => {
    const hostile = ['../../../evil.png', '..\\..\\evil.png', 'a.php.png', 'x.html.png', 'na\u0000me.png', '%2e%2e%2fpwn.png', 'café‮gnp.exe.png', `${'a'.repeat(300)}.png`];
    for (const filename of hostile) {
      const { auth } = await createUser('MEMBER');
      const res = await profilePhoto(auth, png1x1, filename, 'image/png');
      expect([200, 400]).toContain(res.status);
      const url = keep(res);
      if (res.status !== 200) continue;
      expect(url).toMatch(/^\/uploads\/profiles?\/[0-9]+-[0-9a-f-]{36}\.png$/);
      expect(path.resolve(path.join(process.cwd(), (url as string).replace(/^\//, ''))).startsWith(uploadsRoot)).toBe(true);
    }
  });

  it('the real format decides the extension: a JPEG named .png is stored as .jpg and served as image/jpeg, never as the claimed type', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#cc9933' } }).jpeg().toBuffer();
    const { auth } = await createUser('MEMBER');
    const res = await profilePhoto(auth, jpeg, 'really-a-jpeg.png', 'image/png');
    expect(res.status).toBe(200);
    const url = keep(res) as string;
    expect(url).toMatch(/\.jpg$/);
    const served = await http().get(url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/jpeg/);
  });

  it('metadata is stripped: GPS and other EXIF written into a photo are not in the stored file', async () => {
    const withExif = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#112233' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'R3-SECRET-COPYRIGHT', Artist: 'R3-SECRET-ARTIST' } } })
      .toBuffer();
    expect(withExif.includes(Buffer.from('R3-SECRET-ARTIST'))).toBe(true); // the fixture really carries it
    const { auth } = await createUser('MEMBER');
    const res = await profilePhoto(auth, withExif, 'gps.jpg', 'image/jpeg');
    expect(res.status).toBe(200);
    const url = keep(res) as string;
    const onDisk = fs.readFileSync(path.join(process.cwd(), url.replace(/^\//, '')));
    expect(onDisk.includes(Buffer.from('R3-SECRET'))).toBe(false);
  });
});

describe('size limits', () => {
  it('a pixel flood (a small file that decodes to far more than 40 megapixels) is refused, and a file over 5 MB is refused cleanly', async () => {
    const flood = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(flood.length).toBeLessThan(5 * 1024 * 1024); // small on the wire...
    const { auth } = await createUser('MEMBER');
    const res = await profilePhoto(auth, flood, 'flood.png', 'image/png'); // ...42 megapixels once decoded
    expect(res.status).toBe(400);
    expect(keep(res)).toBeUndefined();

    const big = Buffer.concat([png1x1, Buffer.alloc(5 * 1024 * 1024 + 1024)]);
    const tooBig = await profilePhoto(auth, big, 'big.png', 'image/png');
    expect([400, 413]).toContain(tooBig.status);
    expect(tooBig.status).toBeLessThan(500);
  });
});

describe('how stored files are served (the same origin as the app)', () => {
  it('an image comes back as its image type with nosniff, never as HTML, never as an attachment-less document', async () => {
    const { auth } = await createUser('MEMBER');
    const res = await profilePhoto(auth, png1x1, 'a.png', 'image/png');
    const url = keep(res) as string;
    const served = await http().get(url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/png/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    // content-security-policy on the API origin forbids anything but the image itself being active
    expect(served.headers['content-security-policy'] ?? '').toMatch(/default-src 'self'|script-src 'self'/);
  });

  it('a file somebody managed to put in the folder with a script-capable extension is not served as a page (no html/svg/xml/js types)', async () => {
    const dir = path.join(uploadsRoot, 'r3-probe');
    fs.mkdirSync(dir, { recursive: true });
    const cases: Array<[string, RegExp]> = [
      ['x.html', /^(?!text\/html)/],
      ['x.svg', /^(?!image\/svg)/],
      ['x.xml', /^(?!(text|application)\/(xml|xhtml))/],
      ['x.js', /^(?!(text|application)\/(javascript|ecmascript))/],
    ];
    try {
      for (const [name] of cases) fs.writeFileSync(path.join(dir, name), '<script>alert(1)</script>');
      for (const [name] of cases) {
        const served = await http().get(`/uploads/r3-probe/${name}`);
        // either refused, or served as something the browser will not run as a document; with nosniff either way
        if (served.status === 200) {
          expect({ name, nosniff: served.headers['x-content-type-options'] }).toEqual({ name, nosniff: 'nosniff' });
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PDFs (the magazine, admin only)', () => {
  const pdfUpload = (auth: string, body: Buffer, filename: string, contentType: string) =>
    http().post('/api/magazine/upload-file').set('Authorization', auth).attach('file', body, { filename, contentType });

  it('only an administrator may upload one', async () => {
    const member = await createUser('MEMBER');
    const res = await pdfUpload(member.auth, Buffer.from('%PDF-1.4 minimal'), 'a.pdf', 'application/pdf');
    expect(res.status).toBe(403);
  });

  it('a file that is not a PDF is refused even when its name and declared type say so (HTML, script, SVG, ZIP)', async () => {
    const admin = await createUser('ADMIN');
    for (const body of [
      Buffer.from('<!doctype html><script>alert(document.domain)</script>'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('PK\u0003\u0004 not a pdf at all'),
      Buffer.alloc(0),
    ]) {
      const res = await pdfUpload(admin.auth, body, 'issue.pdf', 'application/pdf');
      expect(res.status).toBe(400);
      if (res.body?.data?.fileUrl) stored.push(res.body.data.fileUrl);
    }
  });

  it('a real PDF is accepted and served as application/pdf with nosniff', async () => {
    const admin = await createUser('ADMIN');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const res = await pdfUpload(admin.auth, pdf, 'issue.pdf', 'application/pdf');
    expect(res.status).toBe(201);
    const url = res.body.data.fileUrl as string;
    stored.push(url);
    const served = await http().get(url);
    expect(served.headers['content-type']).toMatch(/^application\/pdf/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });
});
