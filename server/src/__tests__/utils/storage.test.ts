import fs from 'fs';
import os from 'os';
import path from 'path';

type StorageModule = typeof import('../../utils/storage');

const BUCKET = 'aitd-test-bucket';
const REGION = 'ap-south-1';
const S3_HOST = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

const sharpCalls: string[] = [];
const sharpMock = jest.fn(() => {
  const chain: any = {};
  for (const step of ['rotate', 'resize', 'png', 'webp', 'jpeg']) {
    chain[step] = jest.fn(() => {
      sharpCalls.push(step);
      return chain;
    });
  }
  chain.toBuffer = jest.fn().mockResolvedValue(Buffer.from('optimized'));
  return chain;
});

const load = ({ s3 = false, compression = true } = {}) => {
  const send = jest.fn().mockResolvedValue({});
  let mod!: StorageModule;
  jest.isolateModules(() => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        aws: { accessKeyId: s3 ? 'AK' : '', secretAccessKey: s3 ? 'SK' : '', region: REGION, s3Bucket: BUCKET },
        image: { enableCompression: compression, quality: 80, maxWidth: 100, maxHeight: 100 },
      },
    }));
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({ send })),
      PutObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
      DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
    }));
    jest.doMock('sharp', () => ({ __esModule: true, default: sharpMock }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../../utils/storage');
  });
  return { mod, send };
};

const file = (overrides: Partial<Express.Multer.File> = {}) =>
  ({
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('raw-bytes'),
    ...overrides,
  }) as Express.Multer.File;

let tmp: string;
let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-storage-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
  sharpCalls.length = 0;
  sharpMock.mockClear();
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readUpload = (url: string) => fs.readFileSync(path.join(tmp, url)).toString();

describe('storage (local mode)', () => {
  it('compresses JPEGs and writes them under uploads/<folder>', async () => {
    const { mod } = load();
    const url = await mod.uploadToStorage(file(), 'profiles');
    expect(url).toMatch(/^\/uploads\/profiles\/\d+-[0-9a-f-]{36}\.jpg$/);
    expect(readUpload(url)).toBe('optimized');
    expect(sharpCalls).toEqual(['rotate', 'resize', 'jpeg']);
  });

  it.each([
    ['image/png', 'a.png', '.png', 'png'],
    ['image/webp', 'a.webp', '.webp', 'webp'],
  ])('re-encodes %s', async (mimetype, originalname, ext, step) => {
    const { mod } = load();
    const url = await mod.uploadToStorage(file({ mimetype, originalname }), 'covers');
    expect(url.endsWith(ext)).toBe(true);
    expect(sharpCalls).toContain(step);
  });

  it.each([
    ['application/pdf', 'cv.PDF', '.pdf'],
    ['image/gif', 'anim.gif', '.gif'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv.docx', '.docx'],
  ])('keeps %s untouched with the right extension (not .jpg)', async (mimetype, originalname, ext) => {
    const { mod } = load();
    const url = await mod.uploadToStorage(file({ mimetype, originalname }), 'docs');
    expect(path.extname(url)).toBe(ext);
    expect(readUpload(url)).toBe('raw-bytes');
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it('skips compression when disabled', async () => {
    const { mod } = load({ compression: false });
    const url = await mod.uploadToStorage(file(), 'profiles');
    expect(path.extname(url)).toBe('.jpg');
    expect(readUpload(url)).toBe('raw-bytes');
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it('reads disk-stored uploads from their temp path', async () => {
    const { mod } = load();
    const src = path.join(tmp, 'incoming.pdf');
    fs.writeFileSync(src, 'from-disk');
    const url = await mod.uploadToStorage(
      file({ buffer: undefined as any, path: src, mimetype: 'application/pdf', originalname: 'x.pdf' })
    );
    expect(url.startsWith('/uploads/general/')).toBe(true);
    expect(readUpload(url)).toBe('from-disk');
  });

  it('fails when the upload has no data', async () => {
    const { mod } = load();
    await expect(mod.uploadToStorage(file({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      'Uploaded file buffer is unavailable'
    );
  });

  it('uploadBufferToStorage keeps the base filename', async () => {
    const { mod } = load();
    const url = await mod.uploadBufferToStorage(Buffer.from('%PDF'), 'receipt-42.pdf', 'application/pdf', 'receipts');
    expect(url).toMatch(/^\/uploads\/receipts\/\d+-[0-9a-f-]{36}-receipt-42\.pdf$/);
    expect(readUpload(url)).toBe('%PDF');
  });

  it('uploadBufferToStorage infers an extension when the filename has none', async () => {
    const { mod } = load();
    const url = await mod.uploadBufferToStorage(Buffer.from('bin'), 'blob', 'application/octet-stream');
    expect(url).toMatch(/-blob\.bin$/);
  });

  describe('deleteFromStorage', () => {
    it('deletes a local upload', async () => {
      const { mod } = load();
      const url = await mod.uploadToStorage(file(), 'profiles');
      await mod.deleteFromStorage(url);
      expect(fs.existsSync(path.join(tmp, url))).toBe(false);
    });

    it('ignores a missing local file', async () => {
      const { mod } = load();
      await expect(mod.deleteFromStorage('/uploads/profiles/missing.jpg')).resolves.toBeUndefined();
    });

    it('refuses path traversal out of the uploads directory', async () => {
      const { mod } = load();
      const secret = path.join(tmp, 'secret.txt');
      fs.writeFileSync(secret, 'keep me');

      await mod.deleteFromStorage('/uploads/../secret.txt');
      await mod.deleteFromStorage('/uploads/profiles/../../secret.txt');

      expect(fs.existsSync(secret)).toBe(true);
    });

    it('ignores empty and foreign URLs', async () => {
      const { mod, send } = load();
      await expect(mod.deleteFromStorage('')).resolves.toBeUndefined();
      await expect(mod.deleteFromStorage('https://example.com/a.jpg')).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('resolveLocalUploadPath / isManagedStorageUrl classify URLs', () => {
    const { mod } = load();
    expect(mod.resolveLocalUploadPath('/uploads/profiles/a.jpg')).toBe(path.join(tmp, 'uploads', 'profiles', 'a.jpg'));
    expect(mod.resolveLocalUploadPath('/uploads/../etc/passwd')).toBeNull();
    expect(mod.resolveLocalUploadPath('/uploads/')).toBeNull();
    expect(mod.resolveLocalUploadPath('/static/a.jpg')).toBeNull();
    expect(mod.resolveLocalUploadPath(undefined as any)).toBeNull();

    expect(mod.isManagedStorageUrl('/uploads/profiles/a.jpg')).toBe(true);
    expect(mod.isManagedStorageUrl(`${S3_HOST}/profiles/a.jpg`)).toBe(true);
    expect(mod.isManagedStorageUrl('https://cdn.example.com/a.jpg')).toBe(false);
  });

  it('fileFilter accepts allowed types and rejects look-alike extensions', () => {
    const { mod } = load();
    const filter = (mod.upload as any).fileFilter;
    const check = (originalname: string, mimetype: string) => {
      const cb = jest.fn();
      filter({}, { originalname, mimetype }, cb);
      return cb.mock.calls[0];
    };
    expect(check('a.JPG', 'image/jpeg')).toEqual([null, true]);
    expect(check('b.png', 'image/png')).toEqual([null, true]);
    expect(check('c.gif', 'image/gif')).toEqual([null, true]);
    // Every upload route takes photos, so documents are rejected up front
    expect(check('cv.pdf', 'application/pdf')[0]).toMatchObject({ statusCode: 400, code: 'INVALID_FILE_TYPE' });
    expect(check('cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')[0]).toBeInstanceOf(Error);
    // Mime type must be an exact image type, not a substring match
    expect(check('a.jpg', 'application/x-jpeg-but-not')[0]).toBeInstanceOf(Error);
    expect(check('a.png', 'image/jpeg')[0]).toBeInstanceOf(Error);
    expect(check('evil.jpgx', 'image/jpeg')[0]).toBeInstanceOf(Error);
    expect(check('shell.php', 'image/jpeg')[0]).toBeInstanceOf(Error);
    expect(check('a.jpg', 'text/html')[0]).toBeInstanceOf(Error);
  });
});

describe('storage (S3 mode)', () => {
  it('uploads to the bucket and returns its public URL', async () => {
    const { mod, send } = load({ s3: true });

    const url = await mod.uploadToStorage(file(), 'profiles');

    expect(url).toMatch(new RegExp(`^${S3_HOST.replace(/\./g, '\\.')}/profiles/\\d+-[0-9a-f-]{36}\\.jpg$`));
    const command = send.mock.calls[0][0];
    expect(command.kind).toBe('put');
    expect(command.input).toMatchObject({ Bucket: BUCKET, ContentType: 'image/jpeg' });
    expect(url.endsWith(command.input.Key)).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'uploads'))).toBe(false);
  });

  it('uploadBufferToStorage uploads to the bucket', async () => {
    const { mod, send } = load({ s3: true });
    const url = await mod.uploadBufferToStorage(Buffer.from('%PDF'), 'r.pdf', 'application/pdf', 'receipts');
    expect(url).toMatch(/\/receipts\/\d+-[0-9a-f-]{36}-r\.pdf$/);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: BUCKET, ContentType: 'application/pdf' });
  });

  it('deletes objects from our own bucket by key', async () => {
    const { mod, send } = load({ s3: true });
    await mod.deleteFromStorage(`${S3_HOST}/profiles/a%20b.jpg`);
    expect(send).toHaveBeenCalledWith({ kind: 'delete', input: { Bucket: BUCKET, Key: 'profiles/a b.jpg' } });
  });

  it.each([
    'https://other-bucket.s3.ap-south-1.amazonaws.com/profiles/a.jpg',
    'https://evil.example.com/x.amazonaws.com/profiles/a.jpg',
    `http://${BUCKET}.s3.${REGION}.amazonaws.com/profiles/a.jpg`,
    `${S3_HOST}/`,
    `${S3_HOST}/profiles/..%2Fsecret`,
    'not a url',
  ])('never deletes objects for %s', async (url) => {
    const { mod, send } = load({ s3: true });
    await mod.deleteFromStorage(url);
    expect(send).not.toHaveBeenCalled();
  });

  it('still cleans up legacy local uploads', async () => {
    const { mod, send } = load({ s3: true });
    const dir = path.join(tmp, 'uploads', 'profiles');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'old.jpg'), 'x');

    await mod.deleteFromStorage('/uploads/profiles/old.jpg');

    expect(fs.existsSync(path.join(dir, 'old.jpg'))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('getS3KeyFromUrl extracts keys only for our bucket', () => {
    const { mod } = load({ s3: true });
    expect(mod.getS3KeyFromUrl(`${S3_HOST}/covers/x.png`)).toBe('covers/x.png');
    expect(mod.getS3KeyFromUrl('https://s3.amazonaws.com/covers/x.png')).toBeNull();
  });
});
