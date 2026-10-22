import fs from 'fs';
import os from 'os';
import path from 'path';

type StorageModule = typeof import('../../utils/storage');

const BUCKET = 'aitd-test-bucket';
const REGION = 'ap-south-1';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(16)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);

const load = ({ s3 = false, multerSingle }: { s3?: boolean; multerSingle?: jest.Mock } = {}) => {
  const send = jest.fn().mockResolvedValue({});
  let mod!: StorageModule;
  jest.isolateModules(() => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        aws: { accessKeyId: s3 ? 'AK' : '', secretAccessKey: s3 ? 'SK' : '', region: REGION, s3Bucket: BUCKET },
        image: { enableCompression: false, quality: 80, maxWidth: 100, maxHeight: 100 },
      },
    }));
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({ send })),
      PutObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
      DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
    }));
    if (multerSingle) {
      const multer: any = jest.fn(() => ({ single: jest.fn(() => multerSingle), array: jest.fn() }));
      multer.memoryStorage = jest.fn();
      multer.diskStorage = jest.fn((opts) => opts);
      jest.doMock('multer', () => ({ __esModule: true, default: multer }));
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../../utils/storage');
  });
  return { mod, send };
};

let tmp: string;
let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-video-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tempUpload = (bytes: Buffer) => {
  const p = path.join(tmp, `${Math.random().toString(36).slice(2)}.upload`);
  fs.writeFileSync(p, bytes);
  return p;
};

describe('sniffVideoFormat', () => {
  it.each([
    ['mp4', MP4],
    ['mov', MOV],
    ['webm', WEBM],
  ])('recognises %s from its first bytes', (format, bytes) => {
    const { mod } = load();
    expect(mod.sniffVideoFormat(bytes)).toBe(format);
  });

  it.each([
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])],
    ['text renamed to .mp4', Buffer.from('hello world, not a video')],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s', (_label, bytes) => {
    const { mod } = load();
    expect(mod.sniffVideoFormat(bytes)).toBeNull();
  });
});

describe('storeVideo (local)', () => {
  it.each([
    [MP4, '.mp4', 'video/mp4'],
    [MOV, '.mov', 'video/quicktime'],
    [WEBM, '.webm', 'video/webm'],
  ])('stores the file under uploads/videos with the sniffed type and removes the temp file', async (bytes, ext, mimeType) => {
    const { mod } = load();
    const temp = tempUpload(bytes);

    const result = await mod.storeVideo(temp);

    expect(result.url).toMatch(new RegExp(`^/uploads/videos/\\d+-[0-9a-f-]{36}\\${ext}$`));
    expect(result).toMatchObject({ mimeType, size: bytes.length });
    expect(fs.readFileSync(path.join(tmp, result.url)).equals(bytes)).toBe(true);
    expect(fs.existsSync(temp)).toBe(false);
    expect(mod.isManagedStorageUrl(result.url)).toBe(true);
  });

  it('rejects a file that is not really a video and still removes the temp file', async () => {
    const { mod } = load();
    const temp = tempUpload(Buffer.from('MZ fake executable'));
    await expect(mod.storeVideo(temp)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FILE_TYPE' });
    expect(fs.existsSync(temp)).toBe(false);
  });
});

describe('storeVideo (S3)', () => {
  it('streams the file to the bucket with the sniffed content type', async () => {
    const { mod, send } = load({ s3: true });
    const temp = tempUpload(MP4);

    const result = await mod.storeVideo(temp, 'reels');

    const command = send.mock.calls[0][0];
    expect(command.input).toMatchObject({ Bucket: BUCKET, ContentType: 'video/mp4', ContentLength: MP4.length, ACL: 'public-read' });
    expect(command.input.Key).toMatch(/^reels\/\d+-[0-9a-f-]{36}\.mp4$/);
    expect(typeof command.input.Body.pipe).toBe('function');
    command.input.Body.destroy();
    expect(result.url).toBe(`https://${BUCKET}.s3.${REGION}.amazonaws.com/${command.input.Key}`);
    expect(fs.existsSync(temp)).toBe(false);
  });
});

describe('videoUpload middleware', () => {
  it('words the size error for videos (413 FILE_TOO_LARGE)', () => {
    const tooBig = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
    const { mod } = load({ multerSingle: jest.fn((_req, _res, cb) => cb(tooBig)) });
    const next = jest.fn();
    mod.videoUpload({} as any, {} as any, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE', message: 'Video is too large (max 100 MB)' });
  });

  it('passes other outcomes through unchanged', () => {
    const other = Object.assign(new Error('Unexpected field'), { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' });
    const single = jest.fn((_req, _res, cb) => cb(other));
    const { mod } = load({ multerSingle: single });
    const next = jest.fn();
    mod.videoUpload({} as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(other);

    single.mockImplementation((_req, _res, cb) => cb());
    mod.videoUpload({} as any, {} as any, next);
    expect(next).toHaveBeenLastCalledWith(undefined);
  });

  it('accepts only video extensions with a matching video mime type, into a temp dir', () => {
    const { mod } = load({ multerSingle: jest.fn() });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const multer = require('multer').default as jest.Mock;
    void mod;
    const options = multer.mock.calls.find((c: any[]) => c[0]?.limits?.files === 1)[0];
    expect(options.limits.fileSize).toBe(100 * 1024 * 1024);

    const check = (originalname: string, mimetype: string) => {
      const cb = jest.fn();
      options.fileFilter({}, { originalname, mimetype }, cb);
      return cb.mock.calls[0];
    };
    expect(check('clip.mp4', 'video/mp4')).toEqual([null, true]);
    expect(check('clip.MOV', 'video/quicktime')).toEqual([null, true]);
    expect(check('clip.webm', 'video/webm')).toEqual([null, true]);
    expect(check('clip.mp4', 'image/png')[0]).toMatchObject({ statusCode: 400, code: 'INVALID_FILE_TYPE' });
    expect(check('clip.exe', 'video/mp4')[0]).toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(check('', 'video/mp4')[0]).toMatchObject({ code: 'INVALID_FILE_TYPE' });

    const storage = options.storage;
    const dest = jest.fn();
    storage.destination({}, {}, dest);
    expect(dest.mock.calls[0][1]).toBe(path.join(os.tmpdir(), 'aitd-video-uploads'));
    const name = jest.fn();
    storage.filename({}, {}, name);
    expect(name.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}\.upload$/);
  });
});
