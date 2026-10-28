import { z } from 'zod';

const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEARS_AHEAD = 5;

/** Trimmed, lower-cased email (service layer normalises the same way). */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Invalid email address');

/** Mirrors the client rule: 8-128 chars with upper, lower and a digit. */
export const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one uppercase letter, one lowercase letter, and one number'
  );

export const batchYearField = z
  .number()
  .int('Batch year must be a whole number')
  .min(MIN_BATCH_YEAR, `Batch year must be ${MIN_BATCH_YEAR} or later`)
  // Evaluated per request so a long-running server does not freeze the upper bound
  .refine((year) => year <= new Date().getFullYear() + MAX_BATCH_YEARS_AHEAD, {
    message: `Batch year cannot be more than ${MAX_BATCH_YEARS_AHEAD} years in the future`,
  });

export const registerSchema = z.object({
  body: z.object({
    email: emailField,
    password: strongPassword,
    fullName: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long'),
    batchYear: batchYearField,
    department: z.string().trim().min(1, 'Department is required').max(100),
    degree: z.string().trim().min(1, 'Degree is required').max(100),
    roleType: z.enum(['STUDENT', 'ALUMNI', 'FACULTY']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: z.string().min(1, 'Password is required').max(1024, 'Password is too long'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailField,
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required').max(256),
    password: strongPassword,
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required').max(1024, 'Password is too long'),
    newPassword: strongPassword,
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required').max(256),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required').max(1024),
  }),
});

export const verify2FASchema = z.object({
  body: z.object({
    twoFactorToken: z.string().min(1, 'Verification session is required').max(1024),
    otp: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
  }),
});

export const resend2FASchema = z.object({
  body: z.object({
    twoFactorToken: z.string().min(1, 'Verification session is required').max(1024),
  }),
});

export const oauthExchangeSchema = z.object({
  body: z.object({
    code: z.string().min(1, 'Exchange code is required').max(256),
  }),
});

// ============== Profile schemas (PRD 6.3) ==============

/** MySQL `String` columns are VARCHAR(191). */
const VARCHAR_MAX = 191;
const MIN_PROFILE_YEAR = 1900;
const MAX_PROFILE_YEARS_AHEAD = 10;
/** Mirror MAX_SKILLS / MAX_SKILL_NAME_LENGTH in userService (which re-validates). */
export const SKILLS_MAX = 50;
export const SKILL_NAME_MAX = 50;

const maxProfileYear = () => new Date().getFullYear() + MAX_PROFILE_YEARS_AHEAD;

/** Blank strings from cleared form fields become null so the column is cleared. */
const emptyStringToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/** Optional, nullable, trimmed text; '' clears it. */
const optionalText = (max: number, label: string) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max, `${label} must be at most ${max} characters`).nullable().optional());

const requiredText = (max: number, label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** Absolute http(s) URL only (no javascript:, data:, ftp: ...). */
export const httpUrlField = z
  .string()
  .trim()
  .max(VARCHAR_MAX, `Links must be at most ${VARCHAR_MAX} characters`)
  .url('Enter a valid URL')
  .refine((value) => /^https?:\/\//i.test(value), { message: 'Links must start with http:// or https://' });

const optionalHttpUrl = z.preprocess(emptyStringToNull, httpUrlField.nullable().optional());

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTime = z.string().datetime({ offset: true });

/**
 * A calendar date as `YYYY-MM-DD` (midnight UTC) or a full ISO 8601 datetime, coerced to a Date.
 * Rejects impossible dates such as 2021-02-30 and years outside 1900..now+10.
 */
export const dateField = z.union([z.date(), z.string().trim()]).transform((value, ctx) => {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else {
    const match = DATE_ONLY.exec(value);
    if (match) {
      const [year, month, day] = match.slice(1).map(Number);
      const candidate = new Date(Date.UTC(year, month - 1, day));
      const exists =
        candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
      if (exists) date = candidate;
    } else if (isoDateTime.safeParse(value).success) {
      date = new Date(value);
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  const year = date.getUTCFullYear();
  if (year < MIN_PROFILE_YEAR || year > maxProfileYear()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Year must be between ${MIN_PROFILE_YEAR} and ${maxProfileYear()}`,
    });
    return z.NEVER;
  }
  return date;
});

const yearField = z
  .number({ required_error: 'Year is required', invalid_type_error: 'Year must be a number' })
  .int('Year must be a whole number')
  .min(MIN_PROFILE_YEAR, `Year must be ${MIN_PROFILE_YEAR} or later`)
  .refine((year) => year <= maxProfileYear(), {
    message: `Year cannot be more than ${MAX_PROFILE_YEARS_AHEAD} years ahead`,
  });

/** `:id` route param for owned profile rows. */
export const idParamSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid id') }),
});

const nonEmptyPartial = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Nothing to update' });

const lat = z
  .number({ invalid_type_error: 'Latitude must be a number' })
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');
const lng = z
  .number({ invalid_type_error: 'Longitude must be a number' })
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be at most 100 characters')
      .optional(),
    profilePhotoUrl: optionalHttpUrl,
    coverPhotoUrl: optionalHttpUrl,
    currentDesignation: optionalText(150, 'Designation'),
    shortBio: optionalText(500, 'Bio'),
    city: optionalText(100, 'City'),
    hometown: optionalText(100, 'Hometown'),
    locationLat: z
      .number({ invalid_type_error: 'Latitude must be a number' })
      .min(-90, 'Latitude must be between -90 and 90')
      .max(90, 'Latitude must be between -90 and 90')
      .nullable()
      .optional(),
    locationLng: z
      .number({ invalid_type_error: 'Longitude must be a number' })
      .min(-180, 'Longitude must be between -180 and 180')
      .max(180, 'Longitude must be between -180 and 180')
      .nullable()
      .optional(),
    // Residence (home) and work coordinates. The server derives the map pin from these.
    homeLat: lat.nullable().optional(),
    homeLng: lng.nullable().optional(),
    workLat: lat.nullable().optional(),
    workLng: lng.nullable().optional(),
    workCity: optionalText(100, 'Work city'),
    isLocationPublic: z.boolean().optional(),
    phoneNumber: z.preprocess(
      emptyStringToNull,
      z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9\s\-().]{5,19}$/, 'Enter a valid phone number')
        .nullable()
        .optional()
    ),
    phoneVisibility: z.enum(['PUBLIC', 'CONNECTIONS', 'PRIVATE']).optional(),
    linkedinUrl: optionalHttpUrl,
    twitterUrl: optionalHttpUrl,
    githubUrl: optionalHttpUrl,
    websiteUrl: optionalHttpUrl,
    secondaryEmail: z.preprocess(emptyStringToNull, emailField.nullable().optional()),
  }),
});

// Work experience schemas
const workExperienceFields = {
  company: requiredText(150, 'Company name'),
  role: requiredText(150, 'Role'),
  location: optionalText(150, 'Location'),
  startDate: dateField,
  endDate: dateField.nullable().optional(),
  isCurrent: z.boolean().optional(),
  description: optionalText(2000, 'Description'),
};

const endNotBeforeStart = (body: { startDate?: Date; endDate?: Date | null }, ctx: z.RefinementCtx) => {
  if (body.startDate && body.endDate && body.endDate < body.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date cannot be before start date' });
  }
};

export const workExperienceSchema = z.object({
  body: z.object(workExperienceFields).superRefine(endNotBeforeStart),
});

export const updateWorkExperienceSchema = idParamSchema.extend({
  body: nonEmptyPartial(workExperienceFields).superRefine(endNotBeforeStart),
});

// Education schemas
const educationFields = {
  institution: requiredText(VARCHAR_MAX, 'Institution'),
  degree: requiredText(150, 'Degree'),
  fieldOfStudy: optionalText(150, 'Field of study'),
  startYear: yearField,
  endYear: yearField.nullable().optional(),
  grade: optionalText(50, 'Grade'),
  description: optionalText(2000, 'Description'),
  isPrimary: z.boolean().optional(),
};

const endYearNotBeforeStart = (body: { startYear?: number; endYear?: number | null }, ctx: z.RefinementCtx) => {
  if (typeof body.startYear === 'number' && typeof body.endYear === 'number' && body.endYear < body.startYear) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYear'], message: 'End year cannot be before start year' });
  }
};

export const educationSchema = z.object({
  body: z.object(educationFields).superRefine(endYearNotBeforeStart),
});

export const updateEducationSchema = idParamSchema.extend({
  body: nonEmptyPartial(educationFields).superRefine(endYearNotBeforeStart),
});

// Skills: trimmed, whitespace-collapsed, de-duplicated case-insensitively, then capped.
const skillName = z
  .string({ invalid_type_error: 'Each skill must be text' })
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Skill names cannot be empty')
      .max(SKILL_NAME_MAX, `Skill names must be at most ${SKILL_NAME_MAX} characters`)
  );

export const updateSkillsSchema = z.object({
  body: z.object({
    skills: z
      .array(skillName, { required_error: 'skills is required', invalid_type_error: 'skills must be a list' })
      // Bound the raw payload before de-duplicating
      .max(SKILLS_MAX * 4, `You can add at most ${SKILLS_MAX} skills`)
      .transform((names) => {
        const seen = new Set<string>();
        return names.filter((name) => {
          const key = name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })
      .pipe(z.array(z.string()).max(SKILLS_MAX, `You can add at most ${SKILLS_MAX} skills`)),
  }),
});

// Post schemas
export const createPostSchema = z.object({
  body: z.object({
    type: z.enum(['GENERAL', 'JOB', 'BUSINESS', 'ANNOUNCEMENT']).optional(),
    content: z.string().min(1, 'Content is required'),
    mediaUrls: z.array(z.string().url()).optional(),
    linkUrl: z.string().url().optional(),
  }),
});

export const updatePostSchema = z.object({
  body: z.object({
    content: z.string().min(1).optional(),
    mediaUrls: z.array(z.string().url()).optional(),
    linkUrl: z.string().url().optional().nullable(),
    isPinned: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().uuid(),
  }),
});

// Comment schemas
export const createCommentSchema = z.object({
  body: z.object({
    content: z.string().min(1, 'Comment is required'),
    parentId: z.string().uuid().optional(),
  }),
  params: z.object({
    postId: z.string().uuid(),
  }),
});

/** Mirrors COMMENT_CONTENT_MAX_LENGTH in postService (which re-validates). */
export const updateCommentSchema = z.object({
  body: z.object({
    content: z
      .string({ required_error: 'Comment is required' })
      .trim()
      .min(1, 'Comment is required')
      .max(2000, 'Comment must be at most 2000 characters'),
  }),
});

// Job schemas
export const createJobSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().min(1, 'Description is required'),
    company: z.string().min(1, 'Company is required'),
    location: z.string().optional(),
    workplaceType: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
    jobType: z.enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'FREELANCE', 'VOLUNTEER', 'MENTORSHIP']).optional(),
    industry: z.string().optional(),
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
    experienceMin: z.number().int().optional(),
    experienceMax: z.number().int().optional(),
    skills: z.array(z.string()).optional(),
    applicationLink: z.string().url().optional(),
    deadline: z.string().datetime().or(z.date()).optional(),
  }),
});

// Event schemas
export const createEventSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().min(1, 'Description is required'),
    bannerUrl: z.string().url().optional(),
    eventType: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
    venue: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    joinLink: z.string().url().optional(),
    startDate: z.string().datetime().or(z.date()),
    endDate: z.string().datetime().or(z.date()).optional(),
    capacity: z.number().int().positive().optional(),
    tags: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
    chapterId: z.string().uuid().optional(),
  }),
});

// Connection schemas
export const connectionRequestSchema = z.object({
  params: z.object({
    userId: z.string().uuid(),
  }),
});

// Message schemas
export const sendMessageSchema = z.object({
  body: z.object({
    content: z.string().min(1, 'Message is required'),
    mediaUrl: z.string().url().optional(),
  }),
  params: z.object({
    receiverId: z.string().uuid(),
  }),
});

// Donation schemas
export const createDonationSchema = z.object({
  body: z.object({
    amount: z.number().positive('Amount must be positive'),
    isAnonymous: z.boolean().optional(),
    dedicatedTo: z.string().optional(),
    message: z.string().optional(),
    chapterId: z.string().uuid().optional(),
  }),
});

// Invite schemas
export const sendInviteSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    fullName: z.string().optional(),
    batchYear: z.number().int().optional(),
    roleType: z.enum(['STUDENT', 'ALUMNI', 'FACULTY']).optional(),
  }),
});

// Marketplace listing schemas (mirror MarketplaceListing in schema.prisma).
// Server-controlled fields (userId, viewCount, isFeatured on create) are stripped by z.object;
// marketplaceService additionally whitelists fields and restricts isFeatured to admins.
export const MARKETPLACE_LISTING_TYPES = ['BUSINESS', 'SERVICE', 'REQUIREMENT', 'FOUNDER'] as const;
export const MARKETPLACE_MAX_IMAGES = 8;
export const MARKETPLACE_LIMITS = {
  titleMin: 3,
  titleMax: 150,
  categoryMin: 2,
  categoryMax: 60,
  descriptionMin: 20,
  descriptionMax: 5000,
  locationMax: 120,
  websiteMax: 500,
  contactInfoMax: 200,
  priceRangeMax: 100,
} as const;

const listingWebsite = z.preprocess(
  emptyStringToNull,
  z
    .string()
    .trim()
    .max(MARKETPLACE_LIMITS.websiteMax, `Website must be at most ${MARKETPLACE_LIMITS.websiteMax} characters`)
    .regex(/^https?:\/\/[^\s]+$/i, 'Website must be an http(s) URL')
    .url('Website must be an http(s) URL')
    .nullable()
    .optional()
);

// Logos/images are URLs produced by our own upload endpoints: either a local /uploads/...
// path or an https bucket URL. Bounded and shape-checked rather than treated as free URLs.
const listingMediaUrl = z
  .string()
  .trim()
  .max(500, 'URL must be at most 500 characters')
  .regex(/^(\/uploads\/|https?:\/\/)/i, 'Must be an uploaded file URL');
const listingLogo = z.preprocess(emptyStringToNull, listingMediaUrl.nullable().optional());
const listingImages = z.array(listingMediaUrl).max(MARKETPLACE_MAX_IMAGES, `At most ${MARKETPLACE_MAX_IMAGES} images`).optional();

const listingFields = {
  type: z.enum(MARKETPLACE_LISTING_TYPES, { errorMap: () => ({ message: 'Type must be BUSINESS, SERVICE, REQUIREMENT or FOUNDER' }) }),
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(MARKETPLACE_LIMITS.titleMin, `Title must be at least ${MARKETPLACE_LIMITS.titleMin} characters`)
    .max(MARKETPLACE_LIMITS.titleMax, `Title must be at most ${MARKETPLACE_LIMITS.titleMax} characters`),
  category: z
    .string({ required_error: 'Category is required' })
    .trim()
    .min(MARKETPLACE_LIMITS.categoryMin, 'Category is required')
    .max(MARKETPLACE_LIMITS.categoryMax, `Category must be at most ${MARKETPLACE_LIMITS.categoryMax} characters`),
  description: z
    .string({ required_error: 'Description is required' })
    .trim()
    .min(MARKETPLACE_LIMITS.descriptionMin, `Description must be at least ${MARKETPLACE_LIMITS.descriptionMin} characters`)
    .max(MARKETPLACE_LIMITS.descriptionMax, `Description must be at most ${MARKETPLACE_LIMITS.descriptionMax} characters`),
  location: optionalText(MARKETPLACE_LIMITS.locationMax, 'Location'),
  website: listingWebsite,
  contactInfo: optionalText(MARKETPLACE_LIMITS.contactInfoMax, 'Contact info'),
  // Free text in the model (e.g. "INR 500-2,000 / hour"), so it is bounded rather than parsed.
  priceRange: optionalText(MARKETPLACE_LIMITS.priceRangeMax, 'Price range'),
  logoUrl: listingLogo,
  images: listingImages,
};

export const createMarketplaceListingSchema = z.object({
  body: z.object({
    ...listingFields,
    type: listingFields.type.optional(),
  }),
});

export const updateMarketplaceListingSchema = z.object({
  body: z.object({
    type: listingFields.type.optional(),
    title: listingFields.title.optional(),
    category: listingFields.category.optional(),
    description: listingFields.description.optional(),
    location: listingFields.location,
    website: listingFields.website,
    contactInfo: listingFields.contactInfo,
    priceRange: listingFields.priceRange,
    logoUrl: listingFields.logoUrl,
    images: listingFields.images,
    /** Owner may pause/unpublish; admins may moderate. */
    isActive: z.boolean({ invalid_type_error: 'isActive must be a boolean' }).optional(),
    /** Admin-only; marketplaceService ignores it for owners. */
    isFeatured: z.boolean({ invalid_type_error: 'isFeatured must be a boolean' }).optional(),
  }),
});

// Pagination query schema
export const paginationSchema = z.object({
  query: z.object({
    page: z.string().transform(Number).optional(),
    limit: z.string().transform(Number).optional(),
  }),
});

// Directory filter schema
export const directoryFilterSchema = z.object({
  query: z.object({
    name: z.string().optional(),
    batchYear: z.string().transform(Number).optional(),
    department: z.string().optional(),
    city: z.string().optional(),
    company: z.string().optional(),
    skills: z.string().optional(), // Comma-separated
    page: z.string().transform(Number).optional(),
    limit: z.string().transform(Number).optional(),
  }),
});
