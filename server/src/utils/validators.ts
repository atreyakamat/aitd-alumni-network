import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    fullName: z.string().min(2, 'Name must be at least 2 characters'),
    batchYear: z.number().int().min(1950).max(new Date().getFullYear() + 5),
    department: z.string().min(1, 'Department is required'),
    degree: z.string().min(1, 'Degree is required'),
    roleType: z.enum(['STUDENT', 'ALUMNI', 'FACULTY']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

// Profile schemas
export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).optional(),
    profilePhotoUrl: z.string().url().optional().nullable(),
    coverPhotoUrl: z.string().url().optional().nullable(),
    currentDesignation: z.string().optional().nullable(),
    shortBio: z.string().max(500).optional().nullable(),
    city: z.string().optional().nullable(),
    hometown: z.string().optional().nullable(),
    locationLat: z.number().optional().nullable(),
    locationLng: z.number().optional().nullable(),
    isLocationPublic: z.boolean().optional(),
    phoneNumber: z.string().optional().nullable(),
    phoneVisibility: z.enum(['PUBLIC', 'CONNECTIONS', 'PRIVATE']).optional(),
    linkedinUrl: z.string().url().optional().nullable(),
    twitterUrl: z.string().url().optional().nullable(),
    githubUrl: z.string().url().optional().nullable(),
    websiteUrl: z.string().url().optional().nullable(),
    secondaryEmail: z.string().email().optional().nullable(),
  }),
});

// Work experience schemas
export const workExperienceSchema = z.object({
  body: z.object({
    company: z.string().min(1, 'Company name is required'),
    role: z.string().min(1, 'Role is required'),
    location: z.string().optional(),
    startDate: z.string().datetime().or(z.date()),
    endDate: z.string().datetime().or(z.date()).optional().nullable(),
    isCurrent: z.boolean().optional(),
    description: z.string().optional(),
  }),
});

// Education schemas
export const educationSchema = z.object({
  body: z.object({
    institution: z.string().min(1, 'Institution is required'),
    degree: z.string().min(1, 'Degree is required'),
    fieldOfStudy: z.string().optional(),
    startYear: z.number().int().min(1950),
    endYear: z.number().int().optional().nullable(),
    grade: z.string().optional(),
    description: z.string().optional(),
    isPrimary: z.boolean().optional(),
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
