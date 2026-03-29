import multer from 'multer';
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

// Local storage configuration
const localDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

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
  storage: isS3Enabled ? multer.memoryStorage() : localDiskStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

/**
 * Uploads a file to S3 or returns local path
 */
export const uploadToStorage = async (file: Express.Multer.File, folder: string = 'general'): Promise<string> => {
  if (isS3Enabled) {
    const key = `${folder}/${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    
    const command = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    });

    await s3Client.send(command);
    return `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
  }

  // If local, return the path (this expects Express static middleware to serve 'uploads' folder)
  return `/${file.path.replace(/\\/g, '/')}`;
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
