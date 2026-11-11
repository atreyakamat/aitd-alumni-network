import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import { AppError } from '../middleware/errorHandler';

// Initialize S3 client if configured
const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

/** Receipts hold donor names and amounts: private in the bucket (public-read is for photos and videos). */
const aclFor = (folder: string) => (folder === 'receipts' ? ('private' as const) : ('public-read' as const));

const isS3Enabled = config.aws.accessKeyId && config.aws.secretAccessKey;

const inferExtension = (mimetype: string, fallback: string = '.bin') => {
  switch (mimetype.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'application/pdf':
      return '.pdf';
    default:
      return fallback;
  }
};

const getFileBuffer = (file: Express.Multer.File): Buffer => {
  if (file.buffer?.length) {
    return file.buffer;
  }

  if (file.path && fs.existsSync(file.path)) {
    return fs.readFileSync(file.path);
  }

  throw new Error('Uploaded file buffer is unavailable');
};

// Declared image types we accept. The REAL format is read from the bytes (never from the filename or
// Content-Type, which the uploader controls) and decides how the image is re-encoded.
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const REENCODED_FORMATS = {
  jpeg: { mimetype: 'image/jpeg', extension: '.jpg' },
  png: { mimetype: 'image/png', extension: '.png' },
  webp: { mimetype: 'image/webp', extension: '.webp' },
  gif: { mimetype: 'image/gif', extension: '.gif' },
} as const;
type ReencodedFormat = keyof typeof REENCODED_FORMATS;

// ~8000 x 5000 pixels: far above any phone photo, far below a "pixel flood" decompression bomb that would
// otherwise expand a tiny file into gigabytes of RAM when decoded.
const MAX_INPUT_PIXELS = 40_000_000;

const invalidImage = () => new AppError('The file is not a valid image', 400, 'INVALID_FILE_TYPE');

/**
 * Every image is decoded and re-encoded. That proves the bytes really are an image (a script or HTML file
 * wearing a .gif name is rejected), destroys polyglot payloads and trailing data, strips EXIF/GPS and other
 * metadata (members' photos must not leak where they were taken), and bounds the pixel count.
 * Non-image types (PDF receipts, documents) are stored untouched.
 */
const optimizeImageBuffer = async (
  buffer: Buffer,
  mimetype: string
): Promise<{ buffer: Buffer; mimetype: string; extension: string }> => {
  const normalizedMimeType = mimetype.toLowerCase();

  if (!IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    // Unknown types return '' so callers fall back to the original file extension
    return {
      buffer,
      mimetype,
      extension: inferExtension(normalizedMimeType, ''),
    };
  }

  const input = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: normalizedMimeType === 'image/gif',
  });

  let format: string | undefined;
  try {
    format = (await input.metadata()).format;
  } catch {
    throw invalidImage();
  }
  if (!format || !(format in REENCODED_FORMATS)) throw invalidImage();
  const target = REENCODED_FORMATS[format as ReencodedFormat];

  const compress = config.image.enableCompression;
  const quality = compress ? config.image.quality : 95;

  try {
    // rotate() bakes in the EXIF orientation; sharp then writes no metadata. GIFs have no orientation (and
    // rotating animated frames is unsupported), so they skip it.
    let pipeline = format === 'gif' ? input : input.rotate();
    if (compress) {
      pipeline = pipeline.resize({
        width: config.image.maxWidth,
        height: config.image.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    let encoded: Buffer;
    switch (format as ReencodedFormat) {
      case 'png':
        encoded = await pipeline.png({ compressionLevel: 9, quality, adaptiveFiltering: true }).toBuffer();
        break;
      case 'webp':
        encoded = await pipeline.webp({ quality }).toBuffer();
        break;
      case 'gif':
        encoded = await pipeline.gif().toBuffer();
        break;
      default:
        encoded = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    return { buffer: encoded, mimetype: target.mimetype, extension: target.extension };
  } catch {
    // Truncated or malformed data that only fails while decoding
    throw invalidImage();
  }
};

// Multer filter: every upload route takes photos, so only images whose extension
// and declared mime type agree are accepted (the image pipeline re-encodes them)
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const fileFilter = (req: any, file: any, cb: any) => {
  const expected = IMAGE_TYPES[path.extname(file.originalname || '').toLowerCase()];
  if (expected && file.mimetype === expected) {
    return cb(null, true);
  }
  cb(new AppError('Invalid file type. Only JPG, PNG, GIF and WebP images are allowed.', 400, 'INVALID_FILE_TYPE'));
};

/**
 * multer buffers every TEXT field of a multipart body in memory and, by default, bounds neither their number nor the
 * request: one authenticated request with a million fields could exhaust the process. The upload routes only ever read
 * a caption or two next to the files, so the text parts are capped tightly.
 */
export const MULTIPART_TEXT_LIMITS = { fields: 10, fieldSize: 16 * 1024, parts: 30 } as const;

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, ...MULTIPART_TEXT_LIMITS }, // 5MB per file
});

// PDF uploads (e.g. the college magazine). Extension and declared MIME type must agree.
const documentFilter = (_req: any, file: any, cb: any) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.pdf' && file.mimetype === 'application/pdf') return cb(null, true);
  cb(new AppError('Invalid file type. Only PDF files are allowed.', 400, 'INVALID_FILE_TYPE'));
};

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: documentFilter,
  limits: { fileSize: 25 * 1024 * 1024, ...MULTIPART_TEXT_LIMITS }, // 25MB per file; text fields bounded like every uploader
});

/**
 * Uploads a file to S3 or returns local path
 */
export const uploadToStorage = async (file: Express.Multer.File, folder: string = 'general'): Promise<string> => {
  const rawBuffer = getFileBuffer(file);
  const originalExtension = path.extname(file.originalname).toLowerCase() || inferExtension(file.mimetype);
  const optimized = await optimizeImageBuffer(rawBuffer, file.mimetype);
  const extension = optimized.extension || originalExtension;

  if (isS3Enabled) {
    const key = `${folder}/${Date.now()}-${uuidv4()}${extension}`;
    
    const command = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
      Body: optimized.buffer,
      ContentType: optimized.mimetype,
      ACL: aclFor(folder),
    });

    await s3Client.send(command);
    return `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
  }

  // Local storage fallback
  const uploadDir = path.join(process.cwd(), 'uploads', folder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uniqueFilename = `${Date.now()}-${uuidv4()}${extension}`;
  const filePath = path.join(uploadDir, uniqueFilename);
  fs.writeFileSync(filePath, optimized.buffer);

  return `/uploads/${folder}/${uniqueFilename}`;
};

/**
 * Uploads a buffer to S3 or local storage
 */
export const uploadBufferToStorage = async (
  buffer: Buffer,
  filename: string,
  mimetype: string,
  folder: string = 'general'
): Promise<string> => {
  const optimized = await optimizeImageBuffer(buffer, mimetype);
  const baseFilename = path.basename(filename, path.extname(filename)) || 'file';
  const extension = optimized.extension || path.extname(filename) || inferExtension(optimized.mimetype);

  if (isS3Enabled) {
    const key = `${folder}/${Date.now()}-${uuidv4()}-${baseFilename}${extension}`;
    
    const command = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
      Body: optimized.buffer,
      ContentType: optimized.mimetype,
      ACL: aclFor(folder),
    });

    await s3Client.send(command);
    return `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
  }

  // Local storage fallback
  const uploadDir = path.join(process.cwd(), 'uploads', folder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uniqueFilename = `${Date.now()}-${uuidv4()}-${baseFilename}${extension}`;
  const filePath = path.join(uploadDir, uniqueFilename);
  fs.writeFileSync(filePath, optimized.buffer);

  return `/uploads/${folder}/${uniqueFilename}`;
};

/**
 * Returns the object key when `fileUrl` points at our own S3 bucket, otherwise null.
 */
export const getS3KeyFromUrl = (fileUrl: string): string | null => {
  try {
    const url = new URL(fileUrl);
    const expectedHost = `${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com`;
    if (url.protocol !== 'https:' || url.hostname !== expectedHost) return null;
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key || key.split('/').some((part) => part === '..' || part === '.')) return null;
    return key;
  } catch {
    return null;
  }
};

/**
 * Resolves a `/uploads/...` URL to a path inside the local uploads directory, or null if it
 * is not a local upload or would escape that directory (path traversal).
 */
export const resolveLocalUploadPath = (fileUrl: string): string | null => {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return null;
  const root = path.resolve(process.cwd(), 'uploads');
  const resolved = path.resolve(path.join(process.cwd(), fileUrl));
  return resolved.startsWith(root + path.sep) ? resolved : null;
};

/** True when the URL refers to a file managed by this storage layer (our bucket or local uploads). */
export const isManagedStorageUrl = (fileUrl: string): boolean =>
  getS3KeyFromUrl(fileUrl) !== null || resolveLocalUploadPath(fileUrl) !== null;

/**
 * Deletes a file from S3 or Local. URLs outside our bucket / uploads directory are ignored.
 */
export const deleteFromStorage = async (fileUrl: string): Promise<void> => {
  if (!fileUrl) return;

  if (isS3Enabled) {
    const key = getS3KeyFromUrl(fileUrl);
    if (key) {
      const command = new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
      });
      await s3Client.send(command);
      return;
    }
  }

  const filePath = resolveLocalUploadPath(fileUrl);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// ---------------------------------------------------------------------------
// Video uploads (post videos): streamed to disk, never buffered in memory
// ---------------------------------------------------------------------------

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_TEMP_DIR = path.join(os.tmpdir(), 'aiem-video-uploads');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm']);

export const VIDEO_FORMATS = {
  mp4: { extension: '.mp4', mimeType: 'video/mp4' },
  mov: { extension: '.mov', mimeType: 'video/quicktime' },
  webm: { extension: '.webm', mimeType: 'video/webm' },
} as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;

/** The container format from the file's first bytes (the extension and declared type are not trusted). */
export const sniffVideoFormat = (header: Buffer): VideoFormat | null => {
  if (header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp') {
    return header.toString('ascii', 8, 10) === 'qt' ? 'mov' : 'mp4';
  }
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return 'webm';
  }
  return null;
};

const videoFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext) && VIDEO_MIME_TYPES.has(String(file.mimetype).toLowerCase())) return cb(null, true);
  cb(new AppError('Invalid file type. Only MP4, MOV and WebM videos are allowed.', 400, 'INVALID_FILE_TYPE'));
};

const videoMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(VIDEO_TEMP_DIR, { recursive: true });
      cb(null, VIDEO_TEMP_DIR);
    },
    filename: (_req, _file, cb) => cb(null, `${uuidv4()}.upload`),
  }),
  fileFilter: videoFileFilter,
  limits: { fileSize: VIDEO_MAX_BYTES, files: 1, ...MULTIPART_TEXT_LIMITS },
});

/** `upload.single('video')` with the size error worded for videos (multer removes the partial file). */
export const videoUpload = (req: Request, res: Response, next: NextFunction) =>
  videoMulter.single('video')(req, res, (err?: unknown) => {
    if (err instanceof Error && err.name === 'MulterError' && (err as multer.MulterError).code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(`Video is too large (max ${VIDEO_MAX_BYTES / 1024 / 1024} MB)`, 413, 'FILE_TOO_LARGE'));
    }
    next(err);
  });

const readHeader = async (filePath: string, bytes = 16): Promise<Buffer> => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/**
 * Moves an uploaded video from the temp dir into storage after checking its real format.
 * The temp file is always removed.
 */
export const storeVideo = async (
  tempPath: string,
  folder: string = 'videos'
): Promise<{ url: string; mimeType: string; size: number }> => {
  try {
    const format = sniffVideoFormat(await readHeader(tempPath));
    if (!format) {
      throw new AppError('Invalid file type. Only MP4, MOV and WebM videos are allowed.', 400, 'INVALID_FILE_TYPE');
    }
    const { extension, mimeType } = VIDEO_FORMATS[format];
    const { size } = await fs.promises.stat(tempPath);
    const filename = `${Date.now()}-${uuidv4()}${extension}`;

    if (isS3Enabled) {
      const key = `${folder}/${filename}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: key,
          Body: fs.createReadStream(tempPath),
          ContentLength: size,
          ContentType: mimeType,
          ACL: 'public-read',
        })
      );
      return { url: `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`, mimeType, size };
    }

    const uploadDir = path.join(process.cwd(), 'uploads', folder);
    await fs.promises.mkdir(uploadDir, { recursive: true });
    // copy + unlink (in finally) also works across devices, unlike rename
    await fs.promises.copyFile(tempPath, path.join(uploadDir, filename));
    return { url: `/uploads/${folder}/${filename}`, mimeType, size };
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
};
