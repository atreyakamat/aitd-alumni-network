import multer from 'multer';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

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
  const originalExtension = inferExtension(normalizedMimeType, '.jpg');

  if (!config.image.enableCompression || !COMPRESSIBLE_IMAGE_TYPES.has(normalizedMimeType)) {
    return {
      buffer,
      mimetype,
      extension: originalExtension,
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

// Multer filter
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and documents are allowed.'));
  }
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
  const originalExtension = path.extname(file.originalname) || inferExtension(file.mimetype);
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
 * Deletes a file from S3 or Local
 */
export const deleteFromStorage = async (fileUrl: string): Promise<void> => {
  if (isS3Enabled && fileUrl.includes('amazonaws.com')) {
    const urlParts = fileUrl.split('.com/');
    if (urlParts.length > 1) {
      const key = urlParts[1];
      const command = new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
      });
      await s3Client.send(command);
    }
  } else if (fileUrl.startsWith('/uploads/')) {
    const filePath = path.join(process.cwd(), fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};
