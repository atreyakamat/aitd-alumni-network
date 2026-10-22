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

const isS3Enabled = config.aws.accessKeyId && config.aws.secretAccessKey;

const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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

const optimizeImageBuffer = async (
  buffer: Buffer,
  mimetype: string
): Promise<{ buffer: Buffer; mimetype: string; extension: string }> => {
  const normalizedMimeType = mimetype.toLowerCase();

  if (!config.image.enableCompression || !COMPRESSIBLE_IMAGE_TYPES.has(normalizedMimeType)) {
    // Unknown types return '' so callers fall back to the original file extension
    // (previously e.g. .gif/.docx uploads were stored with a .jpg extension).
    return {
      buffer,
      mimetype,
      extension: inferExtension(normalizedMimeType, ''),
    };
  }

  const pipeline = sharp(buffer, { failOn: 'none' }).rotate().resize({
    width: config.image.maxWidth,
    height: config.image.maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (normalizedMimeType === 'image/png') {
    const optimized = await pipeline
      .png({ compressionLevel: 9, quality: config.image.quality, adaptiveFiltering: true })
      .toBuffer();
    return {
      buffer: optimized,
      mimetype: 'image/png',
      extension: '.png',
    };
  }

  if (normalizedMimeType === 'image/webp') {
    const optimized = await pipeline.webp({ quality: config.image.quality }).toBuffer();
    return {
      buffer: optimized,
      mimetype: 'image/webp',
      extension: '.webp',
    };
  }

  const optimized = await pipeline.jpeg({ quality: config.image.quality, mozjpeg: true }).toBuffer();
  return {
    buffer: optimized,
    mimetype: 'image/jpeg',
    extension: '.jpg',
  };
};

// Multer filter: every upload route takes photos, so only images whose extension
// and declared mime type agree are accepted (the image pipeline re-encodes them)
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

const fileFilter = (req: any, file: any, cb: any) => {
  const expected = IMAGE_TYPES[path.extname(file.originalname || '').toLowerCase()];
  if (expected && file.mimetype === expected) {
    return cb(null, true);
  }
  cb(new AppError('Invalid file type. Only JPG, PNG and GIF images are allowed.', 400, 'INVALID_FILE_TYPE'));
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
      ACL: 'public-read',
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
      ACL: 'public-read',
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
// Video uploads (posts and reels): streamed to disk, never buffered in memory
// ---------------------------------------------------------------------------

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_TEMP_DIR = path.join(os.tmpdir(), 'aitd-video-uploads');
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
  limits: { fileSize: VIDEO_MAX_BYTES, files: 1 },
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
