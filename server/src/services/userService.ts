import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { calculateProfileCompleteness, paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { Prisma } from '@prisma/client';

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
  department?: string;
  city?: string;
  company?: string;
  skills?: string;
  page?: number;
  limit?: number;
}

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

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Check if viewer is connected
    let isConnected = false;
    let connectionStatus: string | null = null;

    if (viewerId && viewerId !== userId) {
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

    // Hide sensitive fields based on privacy settings
    const { passwordHash, phoneNumber, ...userData } = user;
    
    let visiblePhoneNumber = null;
    if (user.phoneVisibility === 'PUBLIC') {
      visiblePhoneNumber = phoneNumber;
    } else if (user.phoneVisibility === 'CONNECTIONS' && isConnected) {
      visiblePhoneNumber = phoneNumber;
    } else if (viewerId === userId) {
      visiblePhoneNumber = phoneNumber;
    }

    return {
      ...userData,
      phoneNumber: visiblePhoneNumber,
      connectionCount: user._count.connectionsSent + user._count.connectionsReceived,
      postCount: user._count.posts,
      isConnected,
      connectionStatus,
      isOwnProfile: viewerId === userId,
    };
  }

  async updateProfile(userId: string, data: UpdateProfileInput) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        locationLat: data.locationLat ? new Prisma.Decimal(data.locationLat) : null,
        locationLng: data.locationLng ? new Prisma.Decimal(data.locationLng) : null,
      },
    });

    // Recalculate profile completeness
    const completeness = calculateProfileCompleteness(user);
    
    await prisma.user.update({
      where: { id: userId },
      data: { profileCompleteness: completeness },
    });

    return this.getProfile(userId, userId);
  }

  // Work Experience
  async addWorkExperience(userId: string, data: WorkExperienceInput) {
    return prisma.workExperience.create({
      data: {
        userId,
        ...data,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    });
  }

  async updateWorkExperience(userId: string, id: string, data: Partial<WorkExperienceInput>) {
    const experience = await prisma.workExperience.findFirst({
      where: { id, userId },
    });

    if (!experience) {
      throw new AppError('Work experience not found', 404, 'NOT_FOUND');
    }

    return prisma.workExperience.update({
      where: { id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
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
  async addEducation(userId: string, data: EducationInput) {
    return prisma.education.create({
      data: { userId, ...data },
    });
  }

  async updateEducation(userId: string, id: string, data: Partial<EducationInput>) {
    const education = await prisma.education.findFirst({
      where: { id, userId },
    });

    if (!education) {
      throw new AppError('Education not found', 404, 'NOT_FOUND');
    }

    return prisma.education.update({
      where: { id },
      data,
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
    // Delete existing skills
    await prisma.userSkill.deleteMany({ where: { userId } });

    // Get or create skills
    for (const name of skillNames) {
      let skill = await prisma.skill.findUnique({ where: { name } });
      
      if (!skill) {
        skill = await prisma.skill.create({ data: { name } });
      }

      await prisma.userSkill.create({
        data: { userId, skillId: skill.id },
      });
    }

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
      where.fullName = { contains: filters.name };
    }

    if (filters.batchYear) {
      where.batchYear = filters.batchYear;
    }

    if (filters.department) {
      where.department = { contains: filters.department };
    }

    if (filters.city) {
      where.city = { contains: filters.city };
    }

    if (filters.company) {
      where.workExperiences = {
        some: {
          company: { contains: filters.company },
        },
      };
    }

    if (filters.skills) {
      const skillList = filters.skills.split(',').map(s => s.trim());
      where.skills = {
        some: {
          skill: {
            name: { in: skillList },
          },
        },
      };
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
    });

    return {
      batchYear,
      department,
      count: alumni.length,
      alumni,
    };
  }

  // Alumni Nearby (Map)
  async getAlumniLocations() {
    const alumni = await prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        isLocationPublic: true,
        locationLat: { not: null },
        locationLng: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        profilePhotoUrl: true,
        batchYear: true,
        city: true,
        locationLat: true,
        locationLng: true,
        currentDesignation: true,
        workExperiences: {
          where: { isCurrent: true },
          take: 1,
          select: { company: true },
        },
      },
    });

    return alumni.map(a => ({
      ...a,
      locationLat: a.locationLat?.toNumber(),
      locationLng: a.locationLng?.toNumber(),
    }));
  }

  // Stats for landing page
  async getPublicStats() {
    const [
      totalAlumni,
      totalBatches,
      totalCompanies,
      totalCities,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true, isVerified: true } }),
      prisma.user.groupBy({ by: ['batchYear'], _count: true }).then(r => r.length),
      prisma.workExperience.groupBy({ by: ['company'], _count: true }).then(r => r.length),
      prisma.user.groupBy({ by: ['city'], where: { city: { not: null } }, _count: true }).then(r => r.length),
    ]);

    return {
      totalAlumni,
      totalBatches,
      totalCompanies,
      totalCities,
    };
  }
}

export const userService = new UserService();
