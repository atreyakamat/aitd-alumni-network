import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { calculateProfileCompleteness, paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { Prisma, RoleType } from '@prisma/client';
import { deleteFromStorage, isManagedStorageUrl } from '../utils/storage';

interface UpdateProfileInput {
  fullName?: string;
  profilePhotoUrl?: string | null;
  coverPhotoUrl?: string | null;
  currentDesignation?: string | null;
  shortBio?: string | null;
  city?: string | null;
  hometown?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  homeLat?: number | null;
  homeLng?: number | null;
  workLat?: number | null;
  workLng?: number | null;
  workCity?: string | null;
  isLocationPublic?: boolean;
  phoneNumber?: string | null;
  phoneVisibility?: string;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  githubUrl?: string | null;
  websiteUrl?: string | null;
  secondaryEmail?: string | null;
}

interface WorkExperienceInput {
  company: string;
  role: string;
  location?: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  isCurrent?: boolean;
  description?: string;
}

interface EducationInput {
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startYear: number;
  endYear?: number | null;
  grade?: string;
  description?: string;
  isPrimary?: boolean;
}

interface DirectoryFilters {
  name?: string;
  batchYear?: number;
  batchYearStart?: number;
  batchYearEnd?: number;
  roleType?: string;
  department?: string;
  city?: string;
  hometown?: string;
  company?: string;
  industry?: string;
  designation?: string;
  chapterId?: string;
  skills?: string;
  page?: number;
  limit?: number;
}

/** Optional audience filters shared by the map viewport and the nearby search. */
export interface MapAudienceFilters {
  batchYear?: number;
  department?: string;
  search?: string;
}

interface AlumniLocationFilters extends MapAudienceFilters {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  limit?: number;
}

// Only these profile fields may be written by the account owner (no mass assignment of
// userRole, isVerified, isActive, email, isNotable, membershipTierId, profileCompleteness, ...).
const PROFILE_WRITABLE_FIELDS = [
  'fullName',
  'profilePhotoUrl',
  'coverPhotoUrl',
  'currentDesignation',
  'shortBio',
  'city',
  'hometown',
  'isLocationPublic',
  'phoneNumber',
  'phoneVisibility',
  'linkedinUrl',
  'twitterUrl',
  'githubUrl',
  'websiteUrl',
  'secondaryEmail',
] as const;

const PHONE_VISIBILITY = ['PUBLIC', 'CONNECTIONS', 'PRIVATE'];

// Fields only the profile owner may see.
const OWNER_ONLY_FIELDS = ['twoFactorEnabled', 'lastLoginAt', 'emailVerifiedAt'] as const;
// Contact e-mails are hidden from anonymous (logged-out) viewers.
const AUTHENTICATED_ONLY_FIELDS = ['email', 'secondaryEmail'] as const;

const COMPLETENESS_FIELDS = {
  profilePhotoUrl: true,
  shortBio: true,
  city: true,
  linkedinUrl: true,
  currentDesignation: true,
} as const;

export const MAX_SKILLS = 50;
export const MAX_SKILL_NAME_LENGTH = 50;
export const MAX_DIRECTORY_SKILL_FILTERS = 20;
export const YEARBOOK_MAX_RESULTS = 1000;
export const LOCATIONS_DEFAULT_LIMIT = 1000;
export const LOCATIONS_MAX_LIMIT = 5000;
export const NEARBY_DEFAULT_RADIUS_KM = 50;
export const NEARBY_MAX_RADIUS_KM = 500;
export const NEARBY_DEFAULT_LIMIT = 100;
export const NEARBY_MAX_LIMIT = 200;
export const NOTABLE_MAX_LIMIT = 24;

/**
 * Shared coordinates are stored rounded to this many decimals (~1.1 km at 2) so the map
 * shows a neighbourhood, never a home address. Reads round again for rows written before.
 */
export const LOCATION_PRECISION_DECIMALS = 2;
const EARTH_RADIUS_KM = 6371.0088;

// Conservative (smallest) km-per-degree values so the bounding box always contains the circle.
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_AT_EQUATOR = 111.32;

const ALUMNI_CARD_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  batchYear: true,
  department: true,
  degree: true,
  currentDesignation: true,
  shortBio: true,
  city: true,
  workExperiences: {
    where: { isCurrent: true },
    take: 1,
    select: { company: true, role: true },
  },
} satisfies Prisma.UserSelect;

const PHOTO_RESULT_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  coverPhotoUrl: true,
  profileCompleteness: true,
} satisfies Prisma.UserSelect;

const badRequest = (message: string, code = 'VALIDATION_ERROR') => new AppError(message, 400, code);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseDate = (value: unknown, field: string): Date => {
  const date = value instanceof Date ? value : new Date(value as string);
  if (value === null || value === undefined || value === '' || Number.isNaN(date.getTime())) {
    throw badRequest(`${field} must be a valid date`);
  }
  return date;
};

const parseCoordinate = (value: unknown, field: string, max: number): Prisma.Decimal | null => {
  if (value === null) return null;
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num < -max || num > max) {
    throw badRequest(`${field} must be a number between -${max} and ${max}`);
  }
  return new Prisma.Decimal(roundCoordinate(num));
};

const clampInt = (value: number | undefined, fallback: number, min: number, max: number) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
};

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof (value as Prisma.Decimal).toNumber === 'function') return (value as Prisma.Decimal).toNumber();
  return Number(value);
};

export const roundCoordinate = (value: number) => {
  const factor = 10 ** LOCATION_PRECISION_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** `%term%` for ILIKE with the user's own wildcards escaped. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const mapAudienceWhere = (filters: MapAudienceFilters): Prisma.UserWhereInput => {
  const where: Prisma.UserWhereInput = {};
  if (filters.batchYear !== undefined) where.batchYear = filters.batchYear;
  if (filters.department) where.department = ilike(filters.department);
  if (filters.search) where.OR = [{ fullName: ilike(filters.search) }, { city: ilike(filters.search) }];
  return where;
};

const MAP_ALUMNI_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  batchYear: true,
  department: true,
  city: true,
  locationLat: true,
  locationLng: true,
  currentDesignation: true,
  workExperiences: {
    where: { isCurrent: true },
    take: 1,
    select: { company: true },
  },
} satisfies Prisma.UserSelect;

type MapAlumniRow = Prisma.UserGetPayload<{ select: typeof MAP_ALUMNI_SELECT }>;

const toMapAlumnus = (row: MapAlumniRow) => {
  const lat = toNumber(row.locationLat);
  const lng = toNumber(row.locationLng);
  return {
    ...row,
    company: row.workExperiences[0]?.company ?? null,
    locationLat: lat === undefined ? undefined : roundCoordinate(lat),
    locationLng: lng === undefined ? undefined : roundCoordinate(lng),
  };
};

export class UserService {
  async getProfile(userId: string, viewerId?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membershipTier: true,
        workExperiences: {
          orderBy: { startDate: 'desc' },
        },
        educations: {
          orderBy: { startYear: 'desc' },
        },
        skills: {
          include: { skill: true },
        },
        chapterMemberships: {
          include: { chapter: true },
        },
        marketplaceListings: {
          where: { isActive: true },
          take: 5,
        },
        _count: {
          select: {
            connectionsSent: { where: { status: 'ACCEPTED' } },
            connectionsReceived: { where: { status: 'ACCEPTED' } },
            posts: true,
          },
        },
      },
    });

    const isOwnProfile = !!viewerId && viewerId === userId;

    // Deactivated accounts are invisible to everyone but their owner.
    if (!user || (!user.isActive && !isOwnProfile)) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Check if viewer is connected
    let isConnected = false;
    let connectionStatus: string | null = null;

    if (viewerId && !isOwnProfile) {
      const connection = await prisma.connection.findFirst({
        where: {
          OR: [
            { requesterId: viewerId, addresseeId: userId },
            { requesterId: userId, addresseeId: viewerId },
          ],
        },
      });

      if (connection) {
        connectionStatus = connection.status;
        isConnected = connection.status === 'ACCEPTED';
      }
    }

    // Never expose credentials; hide the rest according to privacy settings.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, phoneNumber, locationLat, locationLng, homeLat, homeLng, workLat, workLng, ...userData } =
      user as typeof user & { passwordHash?: string | null };
    const profile: Record<string, unknown> = { ...userData };

    let visiblePhoneNumber: string | null = null;
    if (isOwnProfile) {
      visiblePhoneNumber = phoneNumber;
    } else if (user.phoneVisibility === 'PUBLIC') {
      visiblePhoneNumber = phoneNumber;
    } else if (user.phoneVisibility === 'CONNECTIONS' && isConnected) {
      visiblePhoneNumber = phoneNumber;
    }

    const showPreciseLocation = isOwnProfile || user.isLocationPublic;

    if (!isOwnProfile) {
      for (const field of OWNER_ONLY_FIELDS) delete profile[field];
      if (!viewerId) {
        for (const field of AUTHENTICATED_ONLY_FIELDS) delete profile[field];
      }
    }

    return {
      ...profile,
      phoneNumber: visiblePhoneNumber,
      locationLat: showPreciseLocation ? toNumber(locationLat) ?? null : null,
      locationLng: showPreciseLocation ? toNumber(locationLng) ?? null : null,
      // Residence/work coordinates are precise location data: only the owner (or a public
      // profile) exposes them so the edit form can prefill both pickers.
      homeLat: showPreciseLocation ? toNumber(homeLat) ?? null : null,
      homeLng: showPreciseLocation ? toNumber(homeLng) ?? null : null,
      workLat: showPreciseLocation ? toNumber(workLat) ?? null : null,
      workLng: showPreciseLocation ? toNumber(workLng) ?? null : null,
      connectionCount: user._count.connectionsSent + user._count.connectionsReceived,
      postCount: user._count.posts,
      isConnected,
      connectionStatus,
      isOwnProfile,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, isActive: true, coverPhotoUrl: true,
        homeLat: true, homeLng: true, workLat: true, workLng: true,
        ...COMPLETENESS_FIELDS,
      },
    });

    if (!existing || !existing.isActive) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const update: Record<string, unknown> = {};
    for (const field of PROFILE_WRITABLE_FIELDS) {
      if (data[field] !== undefined) update[field] = data[field];
    }

    if ('fullName' in update && !isNonEmptyString(update.fullName)) {
      throw badRequest('fullName cannot be empty');
    }
    if (typeof update.fullName === 'string') update.fullName = update.fullName.trim();

    if ('phoneVisibility' in update && !PHONE_VISIBILITY.includes(update.phoneVisibility as string)) {
      throw badRequest('phoneVisibility must be one of PUBLIC, CONNECTIONS, PRIVATE');
    }

    if ('isLocationPublic' in update && typeof update.isLocationPublic !== 'boolean') {
      throw badRequest('isLocationPublic must be a boolean');
    }

    // Photos stored on our own storage can only be set through the upload endpoints, otherwise
    // a user could point their profile at someone else's file and have it deleted on next upload.
    for (const field of ['profilePhotoUrl', 'coverPhotoUrl'] as const) {
      const value = update[field];
      if (typeof value === 'string' && value !== existing[field] && isManagedStorageUrl(value)) {
        throw badRequest(`${field} must be set via the upload endpoint`, 'INVALID_PHOTO_URL');
      }
    }

    // Location coordinates. homeLat/Lng is the residence, workLat/Lng the work location.
    // Legacy clients send locationLat/Lng for the residence, so those alias to home.
    // Only touch what was supplied (undefined = leave unchanged, null = clear).
    if (data.workCity !== undefined) {
      update.workCity = isNonEmptyString(data.workCity) ? (data.workCity as string).trim() : null;
    }
    if (data.homeLat !== undefined || data.locationLat !== undefined) {
      update.homeLat = parseCoordinate(data.homeLat !== undefined ? data.homeLat : data.locationLat, 'homeLat', 90);
    }
    if (data.homeLng !== undefined || data.locationLng !== undefined) {
      update.homeLng = parseCoordinate(data.homeLng !== undefined ? data.homeLng : data.locationLng, 'homeLng', 180);
    }
    if (data.workLat !== undefined) update.workLat = parseCoordinate(data.workLat, 'workLat', 90);
    if (data.workLng !== undefined) update.workLng = parseCoordinate(data.workLng, 'workLng', 180);

    // Derive the map pin: work location when set, otherwise residence. Uses the new value
    // where one was supplied, falling back to what is already stored for the other side.
    const coordsTouched = ['homeLat', 'homeLng', 'workLat', 'workLng', 'locationLat', 'locationLng'].some(
      (k) => data[k] !== undefined
    );
    if (coordsTouched) {
      const current = (key: 'homeLat' | 'homeLng' | 'workLat' | 'workLng', updKey: string) =>
        updKey in update ? (update[updKey] as number | null) : toNumber(existing[key]) ?? null;
      const homeLat = current('homeLat', 'homeLat');
      const homeLng = current('homeLng', 'homeLng');
      const workLat = current('workLat', 'workLat');
      const workLng = current('workLng', 'workLng');
      const hasWork = workLat !== null && workLng !== null;
      update.locationLat = hasWork ? workLat : homeLat;
      update.locationLng = hasWork ? workLng : homeLng;
    }

    update.profileCompleteness = calculateProfileCompleteness({
      profilePhotoUrl: existing.profilePhotoUrl,
      shortBio: existing.shortBio,
      city: existing.city,
      linkedinUrl: existing.linkedinUrl,
      currentDesignation: existing.currentDesignation,
      ...(update as Record<string, string | null>),
    });

    await prisma.user.update({
      where: { id: userId },
      data: update as Prisma.UserUpdateInput,
    });

    return this.getProfile(userId, userId);
  }

  // Work Experience
  private buildWorkExperienceData(data: Partial<WorkExperienceInput>, requireAll: boolean) {
    const out: Prisma.WorkExperienceUncheckedUpdateInput = {};
    const input = (data && typeof data === 'object' ? data : {}) as Partial<WorkExperienceInput>;

    for (const field of ['company', 'role'] as const) {
      if (requireAll || input[field] !== undefined) {
        if (!isNonEmptyString(input[field])) throw badRequest(`${field} is required`);
        out[field] = (input[field] as string).trim();
      }
    }
    if (input.location !== undefined) out.location = input.location;
    if (input.description !== undefined) out.description = input.description;
    if (input.isCurrent !== undefined) out.isCurrent = !!input.isCurrent;

    if (requireAll || input.startDate !== undefined) out.startDate = parseDate(input.startDate, 'startDate');
    if (input.endDate !== undefined) out.endDate = input.endDate === null ? null : parseDate(input.endDate, 'endDate');
    if (out.isCurrent === true) out.endDate = null;
    // Giving a role an end date (without saying otherwise) means it is no longer current.
    else if (out.endDate instanceof Date && input.isCurrent === undefined) out.isCurrent = false;

    return out;
  }

  private assertDateOrder(start: unknown, end: unknown) {
    if (start instanceof Date && end instanceof Date && end < start) {
      throw badRequest('endDate cannot be before startDate');
    }
  }

  async addWorkExperience(userId: string, data: WorkExperienceInput) {
    const fields = this.buildWorkExperienceData(data, true);
    this.assertDateOrder(fields.startDate, fields.endDate);

    return prisma.workExperience.create({
      data: { ...(fields as Prisma.WorkExperienceUncheckedCreateInput), userId },
    });
  }

  async updateWorkExperience(userId: string, id: string, data: Partial<WorkExperienceInput>) {
    const experience = await prisma.workExperience.findFirst({
      where: { id, userId },
    });

    if (!experience) {
      throw new AppError('Work experience not found', 404, 'NOT_FOUND');
    }

    const fields = this.buildWorkExperienceData(data, false);
    this.assertDateOrder(
      fields.startDate ?? experience.startDate,
      fields.endDate !== undefined ? fields.endDate : experience.endDate
    );

    return prisma.workExperience.update({
      where: { id },
      data: fields,
    });
  }

  async deleteWorkExperience(userId: string, id: string) {
    const experience = await prisma.workExperience.findFirst({
      where: { id, userId },
    });

    if (!experience) {
      throw new AppError('Work experience not found', 404, 'NOT_FOUND');
    }

    await prisma.workExperience.delete({ where: { id } });
    return { message: 'Work experience deleted' };
  }

  // Education
  private buildEducationData(data: Partial<EducationInput>, requireAll: boolean) {
    const out: Prisma.EducationUncheckedUpdateInput = {};
    const input = (data && typeof data === 'object' ? data : {}) as Partial<EducationInput>;
    const maxYear = new Date().getFullYear() + 10;

    for (const field of ['institution', 'degree'] as const) {
      if (requireAll || input[field] !== undefined) {
        if (!isNonEmptyString(input[field])) throw badRequest(`${field} is required`);
        out[field] = (input[field] as string).trim();
      }
    }
    for (const field of ['fieldOfStudy', 'grade', 'description'] as const) {
      if (input[field] !== undefined) out[field] = input[field];
    }
    if (input.isPrimary !== undefined) out.isPrimary = !!input.isPrimary;

    const checkYear = (value: unknown, field: string) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1900 || value > maxYear) {
        throw badRequest(`${field} must be a year between 1900 and ${maxYear}`);
      }
      return value;
    };
    if (requireAll || input.startYear !== undefined) out.startYear = checkYear(input.startYear, 'startYear');
    if (input.endYear !== undefined) out.endYear = input.endYear === null ? null : checkYear(input.endYear, 'endYear');

    return out;
  }

  private assertYearOrder(start: unknown, end: unknown) {
    if (typeof start === 'number' && typeof end === 'number' && end < start) {
      throw badRequest('endYear cannot be before startYear');
    }
  }

  async addEducation(userId: string, data: EducationInput) {
    const fields = this.buildEducationData(data, true);
    this.assertYearOrder(fields.startYear, fields.endYear);

    return prisma.education.create({
      data: { ...(fields as Prisma.EducationUncheckedCreateInput), userId },
    });
  }

  async updateEducation(userId: string, id: string, data: Partial<EducationInput>) {
    const education = await prisma.education.findFirst({
      where: { id, userId },
    });

    if (!education) {
      throw new AppError('Education not found', 404, 'NOT_FOUND');
    }

    const fields = this.buildEducationData(data, false);
    this.assertYearOrder(
      fields.startYear ?? education.startYear,
      fields.endYear !== undefined ? fields.endYear : education.endYear
    );

    return prisma.education.update({
      where: { id },
      data: fields,
    });
  }

  async deleteEducation(userId: string, id: string) {
    const education = await prisma.education.findFirst({
      where: { id, userId },
    });

    if (!education) {
      throw new AppError('Education not found', 404, 'NOT_FOUND');
    }

    await prisma.education.delete({ where: { id } });
    return { message: 'Education deleted' };
  }

  // Skills
  async updateSkills(userId: string, skillNames: string[]) {
    if (!Array.isArray(skillNames)) {
      throw badRequest('skills must be an array of skill names');
    }

    // Trim, collapse whitespace, drop blanks/non-strings and de-duplicate case-insensitively.
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of skillNames) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      if (name.length > MAX_SKILL_NAME_LENGTH) {
        throw badRequest(`Skill names must be at most ${MAX_SKILL_NAME_LENGTH} characters`);
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }

    if (names.length > MAX_SKILLS) {
      throw badRequest(`You can add at most ${MAX_SKILLS} skills`, 'TOO_MANY_SKILLS');
    }

    await prisma.$transaction(async (tx) => {
      await tx.userSkill.deleteMany({ where: { userId } });

      const skillIds = new Set<string>();
      for (const name of names) {
        // Reuse the catalogue's spelling ("React" for "react"); PostgreSQL's unique index is case-sensitive
        const skill =
          (await tx.skill.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) ??
          (await tx.skill.upsert({ where: { name }, create: { name }, update: {} }));
        skillIds.add(skill.id);
      }

      if (skillIds.size > 0) {
        await tx.userSkill.createMany({
          data: [...skillIds].map((skillId) => ({ userId, skillId })),
          skipDuplicates: true,
        });
      }
    });

    return prisma.userSkill.findMany({
      where: { userId },
      include: { skill: true },
    });
  }

  // Directory
  async searchDirectory(filters: DirectoryFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.UserWhereInput = {
      isActive: true,
      isVerified: true,
    };

    if (filters.name) {
      where.fullName = ilike(filters.name);
    }

    if (filters.batchYear) {
      where.batchYear = filters.batchYear;
    } else if (filters.batchYearStart || filters.batchYearEnd) {
      where.batchYear = {
        gte: filters.batchYearStart,
        lte: filters.batchYearEnd,
      };
    }

    if (filters.roleType) {
      if (!Object.values(RoleType).includes(filters.roleType as RoleType)) {
        throw badRequest(`roleType must be one of ${Object.values(RoleType).join(', ')}`);
      }
      where.roleType = filters.roleType as RoleType;
    }

    if (filters.department) {
      where.department = ilike(filters.department);
    }

    if (filters.city) {
      where.city = ilike(filters.city);
    }

    if (filters.hometown) {
      where.hometown = ilike(filters.hometown);
    }

    if (filters.designation) {
      where.currentDesignation = ilike(filters.designation);
    }

    if (filters.chapterId) {
      where.chapterMemberships = {
        some: {
          chapterId: filters.chapterId,
        },
      };
    }

    if (filters.company || filters.industry) {
      const or: Prisma.WorkExperienceWhereInput[] = [];
      if (filters.company) or.push({ company: ilike(filters.company) });
      if (filters.industry) {
        or.push({ description: ilike(filters.industry) });
        or.push({ role: ilike(filters.industry) });
      }
      where.workExperiences = { some: { OR: or } };
    }

    if (filters.skills) {
      const skillList = [...new Set(filters.skills.split(',').map((s) => s.trim()).filter(Boolean))].slice(
        0,
        MAX_DIRECTORY_SKILL_FILTERS
      );
      if (skillList.length) {
        where.skills = {
          some: {
            skill: {
              OR: skillList.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })),
            },
          },
        };
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          profilePhotoUrl: true,
          batchYear: true,
          department: true,
          degree: true,
          currentDesignation: true,
          city: true,
          membershipTier: {
            select: { name: true, badgeColor: true },
          },
          workExperiences: {
            where: { isCurrent: true },
            take: 1,
            select: { company: true, role: true },
          },
        },
        skip,
        take,
        orderBy: { fullName: 'asc' },
      }),
      prisma.user.count({ where }),
    ]);

    return buildPaginationResponse(users, total, page, limit);
  }

  // Yearbook
  async getYearbook(batchYear: number, department?: string) {
    if (!Number.isInteger(batchYear)) {
      throw badRequest('batchYear must be a valid year');
    }

    const where: Prisma.UserWhereInput = {
      batchYear,
      isActive: true,
      isVerified: true,
    };

    if (department && department !== 'all') {
      where.department = department;
    }

    const alumni = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        profilePhotoUrl: true,
        department: true,
        degree: true,
        currentDesignation: true,
        city: true,
        membershipTier: {
          select: { name: true, badgeColor: true },
        },
        workExperiences: {
          where: { isCurrent: true },
          take: 1,
          select: { company: true, role: true },
        },
      },
      orderBy: { fullName: 'asc' },
      take: YEARBOOK_MAX_RESULTS,
    });

    return {
      batchYear,
      department,
      count: alumni.length,
      alumni,
    };
  }

  // Alumni Nearby (Map)
  async getAlumniLocations(filters: AlumniLocationFilters = {}) {
    const where: Prisma.UserWhereInput = {
      isActive: true,
      isVerified: true,
      isLocationPublic: true,
      locationLat: { not: null },
      locationLng: { not: null },
      ...mapAudienceWhere(filters),
    };

    if (
      filters.north !== undefined &&
      filters.south !== undefined &&
      filters.east !== undefined &&
      filters.west !== undefined
    ) {
      where.locationLat = {
        not: null,
        gte: filters.south,
        lte: filters.north,
      };

      // Handle antimeridian crossing (e.g. west=170, east=-170)
      if (filters.west <= filters.east) {
        where.locationLng = {
          not: null,
          gte: filters.west,
          lte: filters.east,
        };
      } else {
        // AND-wrapped so it composes with the name/city search OR
        where.AND = [
          {
            OR: [
              { locationLng: { not: null, gte: filters.west } },
              { locationLng: { not: null, lte: filters.east } },
            ],
          },
        ];
      }
    }

    const take = clampInt(filters.limit, LOCATIONS_DEFAULT_LIMIT, 1, LOCATIONS_MAX_LIMIT);

    const alumni = await prisma.user.findMany({
      where,
      select: MAP_ALUMNI_SELECT,
      orderBy: { id: 'asc' },
      take,
    });

    return alumni.map(toMapAlumnus);
  }

  /**
   * Bounding box that fully contains a circle of `radiusKm` around the centre, so the
   * (indexed) locationLat/locationLng columns can prune rows before the exact distance check.
   */
  private boundingBox(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / KM_PER_DEG_LAT;
    const minLat = Math.max(-90, lat - latDelta);
    const maxLat = Math.min(90, lat + latDelta);

    // Near a pole the circle spans every longitude.
    if (minLat <= -90 || maxLat >= 90) {
      return { minLat, maxLat, lng: null as null | { min: number; max: number; wraps: boolean } };
    }

    const widestLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
    const lngDelta = radiusKm / (KM_PER_DEG_LNG_AT_EQUATOR * Math.cos(this.toRad(widestLat)));
    if (lngDelta >= 180) {
      return { minLat, maxLat, lng: null };
    }

    let minLng = lng - lngDelta;
    let maxLng = lng + lngDelta;
    let wraps = false;
    if (minLng < -180) {
      minLng += 360;
      wraps = true;
    } else if (maxLng > 180) {
      maxLng -= 360;
      wraps = true;
    }
    return { minLat, maxLat, lng: { min: minLng, max: maxLng, wraps } };
  }

  // Alumni Nearby with geospatial filtering
  async getNearbyAlumni(
    centerLat: number,
    centerLng: number,
    radiusKm: number = NEARBY_DEFAULT_RADIUS_KM,
    limit: number = NEARBY_DEFAULT_LIMIT,
    filters: MapAudienceFilters = {}
  ) {
    if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) {
      throw badRequest('lat must be between -90 and 90');
    }
    if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) {
      throw badRequest('lng must be between -180 and 180');
    }

    const radius = Number.isFinite(radiusKm) && radiusKm > 0
      ? Math.min(radiusKm, NEARBY_MAX_RADIUS_KM)
      : NEARBY_DEFAULT_RADIUS_KM;
    const take = clampInt(limit, NEARBY_DEFAULT_LIMIT, 1, NEARBY_MAX_LIMIT);

    const box = this.boundingBox(centerLat, centerLng, radius);
    let lngClause = Prisma.empty;
    if (box.lng && !box.lng.wraps) {
      lngClause = Prisma.sql`AND u."locationLng" BETWEEN ${box.lng.min}::float8 AND ${box.lng.max}::float8`;
    } else if (box.lng) {
      lngClause = Prisma.sql`AND (u."locationLng" >= ${box.lng.min}::float8 OR u."locationLng" <= ${box.lng.max}::float8)`;
    }

    const audience: Prisma.Sql[] = [];
    if (filters.batchYear !== undefined) audience.push(Prisma.sql`AND u."batchYear" = ${filters.batchYear}`);
    if (filters.department) {
      audience.push(Prisma.sql`AND u."department" ILIKE ${likePattern(filters.department)}`);
    }
    if (filters.search) {
      const pattern = likePattern(filters.search);
      audience.push(Prisma.sql`AND (u."fullName" ILIKE ${pattern} OR u."city" ILIKE ${pattern})`);
    }

    // The bounding-box predicates use the (locationLat, locationLng) index; the haversine
    // great-circle distance (km) then trims the corners of the box to the exact radius.
    // LEAST(1, ...) keeps ASIN in its domain despite floating-point overshoot.
    const nearbyUsers = await prisma.$queryRaw<{ id: string; distanceKm: unknown }[]>(Prisma.sql`
      SELECT id, "distanceKm" FROM (
        SELECT
          u.id,
          ${EARTH_RADIUS_KM}::float8 * 2 * ASIN(LEAST(1, SQRT(
            POWER(SIN(RADIANS(u."locationLat"::float8 - ${centerLat}::float8) / 2), 2) +
            COS(RADIANS(${centerLat}::float8)) * COS(RADIANS(u."locationLat"::float8)) *
            POWER(SIN(RADIANS(u."locationLng"::float8 - ${centerLng}::float8) / 2), 2)
          ))) AS "distanceKm"
        FROM "User" u
        WHERE u."isActive" = true
          AND u."isVerified" = true
          AND u."isLocationPublic" = true
          AND u."locationLat" IS NOT NULL
          AND u."locationLng" IS NOT NULL
          AND u."locationLat" BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8
          ${lngClause}
          ${audience.length ? Prisma.join(audience, ' ') : Prisma.empty}
      ) AS candidates
      WHERE "distanceKm" <= ${radius}::float8
      ORDER BY "distanceKm", id
      LIMIT ${take}
    `);

    if (nearbyUsers.length === 0) {
      return {
        count: 0,
        centerLat,
        centerLng,
        radiusKm: radius,
        alumni: [],
      };
    }

    const userIds = nearbyUsers.map((u) => u.id);

    // Fetch full user details for the found IDs (privacy filters re-applied defensively)
    const alumni = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        isActive: true,
        isLocationPublic: true,
      },
      select: MAP_ALUMNI_SELECT,
    });

    const byId = new Map(alumni.map((a) => [a.id, a]));

    // Combine with distance data, preserving the distance ordering from SQL
    const nearbyAlumni = nearbyUsers
      .filter((nu) => byId.has(nu.id))
      .map((nu) => ({
        ...toMapAlumnus(byId.get(nu.id)!),
        distanceKm: Math.round(Number(nu.distanceKm) * 10) / 10,
      }));

    return {
      count: nearbyAlumni.length,
      centerLat,
      centerLng,
      radiusKm: radius,
      alumni: nearbyAlumni,
    };
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  // Stats for landing page
  async getPublicStats() {
    const visible = { isActive: true, isVerified: true };
    const [
      totalAlumni,
      totalBatches,
      totalCompanies,
      totalCities,
    ] = await Promise.all([
      prisma.user.count({ where: visible }),
      prisma.user.groupBy({ by: ['batchYear'], where: visible, _count: true }).then((r) => r.length),
      prisma.workExperience
        .groupBy({ by: ['company'], where: { user: visible }, _count: true })
        .then((r) => r.length),
      prisma.user
        .groupBy({ by: ['city'], where: { ...visible, city: { not: null } }, _count: true })
        .then((r) => r.length),
    ]);

    return {
      totalAlumni,
      totalBatches,
      totalCompanies,
      totalCities,
    };
  }

  private fallbackNotableAlumni(take: number) {
    return prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        profilePhotoUrl: { not: null },
      },
      select: ALUMNI_CARD_SELECT,
      orderBy: [
        { profileCompleteness: 'desc' },
        { createdAt: 'desc' },
      ],
      take,
    });
  }

  async getNotableAlumni(limit: number = 6) {
    const take = clampInt(limit, 6, 1, NOTABLE_MAX_LIMIT);
    try {
      const notableAlumni = await prisma.user.findMany({
        where: {
          isNotable: true,
          isActive: true,
          isVerified: true,
        },
        select: ALUMNI_CARD_SELECT,
        take,
      });

      // If no notable alumni found, return top users by profile completeness as fallback
      if (notableAlumni.length === 0) {
        return this.fallbackNotableAlumni(take);
      }

      return notableAlumni;
    } catch (error) {
      // Fallback for any database errors (like missing columns)
      return this.fallbackNotableAlumni(take);
    }
  }

  private async replacePhoto(userId: string, field: 'profilePhotoUrl' | 'coverPhotoUrl', photoUrl: string) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, coverPhotoUrl: true, ...COMPLETENESS_FIELDS },
    });
    if (!existing) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        [field]: photoUrl,
        profileCompleteness: calculateProfileCompleteness({ ...existing, [field]: photoUrl }),
      },
      select: PHOTO_RESULT_SELECT,
    });

    // Remove the old file only after the new one is saved; storage hiccups must not fail the request.
    const previous = existing[field];
    if (previous && previous !== photoUrl) {
      try {
        await deleteFromStorage(previous);
      } catch (error) {
        console.warn(`Failed to delete old ${field}:`, error);
      }
    }

    return updated;
  }

  async updateProfilePhoto(userId: string, photoUrl: string) {
    return this.replacePhoto(userId, 'profilePhotoUrl', photoUrl);
  }

  async updateCoverPhoto(userId: string, photoUrl: string) {
    return this.replacePhoto(userId, 'coverPhotoUrl', photoUrl);
  }
}

export const userService = new UserService();
