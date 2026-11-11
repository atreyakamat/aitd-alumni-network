/**
 * Image uploads are decoded and re-encoded with the REAL sharp (no mocks): content is proven to be an
 * image, polyglots and metadata are destroyed, and pixel floods are refused.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';

type StorageModule = typeof import('../../utils/storage');

let tmp: string;
let cwdSpy: jest.SpyInstance;
let storage: StorageModule;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  storage = require('../../utils/storage');
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiem-img-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const upload = (buffer: Buffer, originalname: string, mimetype: string) =>
  storage.uploadToStorage({ originalname, mimetype, buffer } as Express.Multer.File, 'test');

const stored = (url: string) => fs.readFileSync(path.join(tmp, url));

const solid = (width = 40, height = 30) => ({ create: { width, height, channels: 3 as const, background: '#336699' } });

// Minimal PNG whose header claims far more pixels than any real upload (a decompression bomb in miniature)
const crc32 = (buf: Buffer) => {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const hugePng = () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(30000, 0);
  ihdr.writeUInt32BE(30000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('image uploads', () => {
  it('re-encodes a real JPEG and strips its EXIF/GPS metadata', async () => {
    const withGps = await sharp(solid())
      .withExif({ IFD0: { Copyright: 'someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 31/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined(); // the fixture really carries metadata

    const url = await upload(withGps, 'trip.jpg', 'image/jpeg');

    expect(url).toMatch(/\.jpg$/);
    const meta = await sharp(stored(url)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
  });

  it.each([
    ['png', 'image/png', '.png'],
    ['webp', 'image/webp', '.webp'],
    ['gif', 'image/gif', '.gif'],
  ] as const)('accepts and re-encodes a real %s', async (format, mimetype, ext) => {
    const input = await sharp(solid())[format]().toBuffer();
    const url = await upload(input, `pic${ext}`, mimetype);
    expect(url.endsWith(ext)).toBe(true);
    expect((await sharp(stored(url)).metadata()).format).toBe(format);
  });

  it('stores an image under its REAL format even when the declared type differs', async () => {
    const png = await sharp(solid()).png().toBuffer();
    const url = await upload(png, 'renamed.jpg', 'image/jpeg');
    expect(url).toMatch(/\.png$/);
    expect((await sharp(stored(url)).metadata()).format).toBe('png');
  });

  it('shrinks oversized images to the configured maximum', async () => {
    const big = await sharp(solid(4000, 100)).jpeg().toBuffer();
    const url = await upload(big, 'wide.jpg', 'image/jpeg');
    expect((await sharp(stored(url)).metadata()).width).toBeLessThanOrEqual(1920);
  });

  it.each([
    ['a script polyglot with a GIF header', Buffer.from('GIF89a<script>alert(document.domain)</script>'), 'evil.gif', 'image/gif'],
    ['HTML named .jpg', Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg', 'image/jpeg'],
    ['an SVG named .png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.png', 'image/png'],
    ['plain text', Buffer.from('not an image at all'), 'x.png', 'image/png'],
    ['an empty-ish file', Buffer.from([0xff, 0xd8, 0xff]), 'x.jpg', 'image/jpeg'],
  ])('rejects %s with a 400 INVALID_FILE_TYPE and stores nothing', async (_label, buffer, name, mimetype) => {
    await expect(upload(buffer, name, mimetype)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FILE_TYPE' });
    expect(fs.existsSync(path.join(tmp, 'uploads'))).toBe(false);
  });

  it('rejects a truncated image', async () => {
    const png = await sharp(solid(200, 200)).png().toBuffer();
    await expect(upload(png.subarray(0, Math.floor(png.length / 2)), 'cut.png', 'image/png')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_FILE_TYPE',
    });
  });

  it('refuses a pixel flood (a tiny file that claims to be 30000 x 30000)', async () => {
    const bomb = hugePng();
    expect(bomb.length).toBeLessThan(200);
    await expect(upload(bomb, 'bomb.png', 'image/png')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FILE_TYPE' });
  });

  it('leaves non-image documents (PDF receipts) untouched', async () => {
    const pdf = Buffer.from('%PDF-1.4 receipt');
    const url = await upload(pdf, 'receipt.pdf', 'application/pdf');
    expect(url).toMatch(/\.pdf$/);
    expect(stored(url).equals(pdf)).toBe(true);
  });
});
