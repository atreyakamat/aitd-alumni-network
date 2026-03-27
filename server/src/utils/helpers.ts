import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const generateUUID = (): string => {
  return uuidv4();
};

export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const calculateReadingTime = (content: string): number => {
  const wordsPerMinute = 200;
  const words = content.trim().split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
};

export const calculateProfileCompleteness = (user: {
  profilePhotoUrl?: string | null;
  shortBio?: string | null;
  city?: string | null;
  linkedinUrl?: string | null;
  currentDesignation?: string | null;
}): number => {
  let score = 20; // Base score for having account

  if (user.profilePhotoUrl) score += 20;
  if (user.shortBio && user.shortBio.length > 50) score += 15;
  if (user.city) score += 15;
  if (user.linkedinUrl) score += 15;
  if (user.currentDesignation) score += 15;

  return Math.min(score, 100);
};

export const sanitizeHtml = (html: string): string => {
  // Basic HTML sanitization - for production use a library like DOMPurify
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
};

export const paginationHelper = (page: number = 1, limit: number = 12) => {
  const skip = (page - 1) * limit;
  return {
    skip,
    take: limit,
    page,
    limit,
  };
};

export const buildPaginationResponse = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) => {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};
