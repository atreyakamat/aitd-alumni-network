import { z } from 'zod';

/**
 * Profile editing (PRD 6.3): shapes returned by GET /users/:id for the owner, payloads
 * accepted by the profile endpoints, and client-side rules mirroring the server
 * validators (server/src/utils/validators.ts) and upload limits (server/src/utils/storage.ts).
 */

export type PhoneVisibility = 'PUBLIC' | 'CONNECTIONS' | 'PRIVATE';

export const PHONE_VISIBILITY_OPTIONS: { value: PhoneVisibility; label: string }[] = [
  { value: 'PUBLIC', label: 'Everyone' },
  { value: 'CONNECTIONS', label: 'My connections only' },
  { value: 'PRIVATE', label: 'Only me' },
];

export interface WorkExperienceRecord {
  id: string;
  company: string;
  role: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  isCurrent: boolean;
  description?: string | null;
}

export interface EducationRecord {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string | null;
  startYear: number;
  endYear?: number | null;
  grade?: string | null;
  description?: string | null;
  isPrimary: boolean;
}

export interface ProfileSkill {
  skill: { id: string; name: string };
}

/** The signed-in user's own profile (GET /users/:id with viewer === owner). */
export interface EditableProfile {
  id: string;
  email?: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  coverPhotoUrl?: string | null;
  batchYear: number;
  department: string;
  degree: string;
  currentDesignation?: string | null;
  shortBio?: string | null;
  city?: string | null;
  hometown?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  isLocationPublic?: boolean;
  phoneNumber?: string | null;
  phoneVisibility?: PhoneVisibility;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  githubUrl?: string | null;
  websiteUrl?: string | null;
  secondaryEmail?: string | null;
  profileCompleteness?: number;
  workExperiences?: WorkExperienceRecord[];
  educations?: EducationRecord[];
  skills?: ProfileSkill[];
}

/** PATCH /users/profile body. `null` clears a field. */
export interface ProfileUpdatePayload {
  fullName?: string;
  currentDesignation?: string | null;
  shortBio?: string | null;
  city?: string | null;
  hometown?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  isLocationPublic?: boolean;
  phoneNumber?: string | null;
  phoneVisibility?: PhoneVisibility;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  githubUrl?: string | null;
  websiteUrl?: string | null;
  secondaryEmail?: string | null;
}

/** POST/PATCH /users/work-experience body. Dates are `YYYY-MM-DD`. */
export interface WorkExperienceInput {
  company: string;
  role: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  isCurrent?: boolean;
  description?: string | null;
}

/** POST/PATCH /users/education body. */
export interface EducationInput {
  institution: string;
  degree: string;
  fieldOfStudy?: string | null;
  startYear: number;
  endYear?: number | null;
  grade?: string | null;
  description?: string | null;
  isPrimary?: boolean;
}

export const profileQueryKey = (id: string | undefined) => ['profile', id] as const;

// ---------------------------------------------------------------------------
// Limits (mirror the server)
// ---------------------------------------------------------------------------

export const NAME_MAX = 100;
export const DESIGNATION_MAX = 150;
export const BIO_MAX = 500;
export const PLACE_MAX = 100;
export const LINK_MAX = 191;
export const SKILLS_MAX = 50;
export const SKILL_NAME_MAX = 50;
export const MIN_PROFILE_YEAR = 1900;
export const maxProfileYear = () => new Date().getFullYear() + 10;

/** multer: 5 MB, jpeg/jpg/png/gif only (extension and MIME type are both checked). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/gif';
const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
const PHOTO_EXTENSION = /\.(jpe?g|png|gif)$/i;

/** Returns an error message, or null when the file can be uploaded. */
export function validatePhotoFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!PHOTO_TYPES.includes(file.type.toLowerCase()) || !PHOTO_EXTENSION.test(file.name)) {
    return 'Choose a JPG, PNG or GIF image.';
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return 'Images must be 5 MB or smaller.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const PHONE_PATTERN = /^\+?[0-9][0-9\s\-().]{5,19}$/;

const optionalLink = z
  .string()
  .trim()
  .max(LINK_MAX, `Links must be at most ${LINK_MAX} characters`)
  .refine((value) => value === '' || isHttpUrl(value), 'Enter a full link starting with https://');

export const basicInfoSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`),
  currentDesignation: z.string().trim().max(DESIGNATION_MAX, `Designation must be at most ${DESIGNATION_MAX} characters`),
  shortBio: z.string().trim().max(BIO_MAX, `Bio must be at most ${BIO_MAX} characters`),
});

export const contactSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .refine((value) => value === '' || PHONE_PATTERN.test(value), 'Enter a valid phone number'),
  secondaryEmail: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email address'),
  linkedinUrl: optionalLink,
  twitterUrl: optionalLink,
  githubUrl: optionalLink,
  websiteUrl: optionalLink,
});

/** First message per field from a zod error. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Trimmed text, or null for blank (clears the column on the server). */
export const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `<input type="month">` value (YYYY-MM) → API date (YYYY-MM-01). */
export const monthToDate = (month: string): string => `${month}-01`;

/** API date/ISO datetime → `<input type="month">` value. Dates are stored as midnight UTC. */
export const dateToMonth = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 2020" (UTC, so it does not drift a day in negative offsets). */
export const formatMonth = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * About 1 km of precision at 2 decimals: enough for the alumni map, not a street
 * address. Matches the rounding the server applies before storing coordinates.
 */
export const roundCoordinate = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export function geolocationErrorMessage(error: { code?: number } | null | undefined): string {
  switch (error?.code) {
    case 1:
      return 'Location permission was denied. Allow location access in your browser settings, or enter your city instead.';
    case 2:
      return 'Your location is unavailable right now. Try again, or enter your city instead.';
    case 3:
      return 'Finding your location took too long. Try again.';
    default:
      return 'Could not get your location.';
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const normalizeSkillName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/** Adds a skill unless it is blank, too long, a case-insensitive duplicate, or over the limit. */
export function addSkill(skills: string[], raw: string): { skills: string[]; error?: string } {
  const name = normalizeSkillName(raw);
  if (!name) return { skills };
  if (name.length > SKILL_NAME_MAX) {
    return { skills, error: `Skill names must be at most ${SKILL_NAME_MAX} characters.` };
  }
  if (skills.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
    return { skills, error: `"${name}" is already in your skills.` };
  }
  if (skills.length >= SKILLS_MAX) {
    return { skills, error: `You can add at most ${SKILLS_MAX} skills.` };
  }
  return { skills: [...skills, name] };
}

// ---------------------------------------------------------------------------
// Completeness (mirrors calculateProfileCompleteness in server/src/utils/helpers.ts)
// ---------------------------------------------------------------------------

export interface CompletenessHint {
  id: string;
  label: string;
  points: number;
  done: boolean;
}

export function completenessHints(profile: Partial<EditableProfile>): CompletenessHint[] {
  return [
    { id: 'photo', label: 'Add a profile photo', points: 20, done: Boolean(profile.profilePhotoUrl) },
    {
      id: 'bio',
      label: 'Write a bio of more than 50 characters',
      points: 15,
      done: (profile.shortBio ?? '').length > 50,
    },
    { id: 'city', label: 'Add your current city', points: 15, done: Boolean(profile.city) },
    { id: 'linkedin', label: 'Link your LinkedIn profile', points: 15, done: Boolean(profile.linkedinUrl) },
    { id: 'designation', label: 'Add your current designation', points: 15, done: Boolean(profile.currentDesignation) },
  ];
}
