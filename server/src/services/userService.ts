import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { calculateProfileCompleteness, paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { Prisma } from '@prisma/client';
import { deleteFromStorage } from '../utils/storage';

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

interface AlumniLocationFilters {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
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
    } else if (filters.batchYearStart || filters.batchYearEnd) {
      where.batchYear = {
        gte: filters.batchYearStart,
        lte: filters.batchYearEnd,
      };
    }

    if (filters.roleType) {
      where.roleType = filters.roleType as any;
    }

    if (filters.department) {
      where.department = { contains: filters.department };
    }

    if (filters.city) {
      where.city = { contains: filters.city };
    }

    if (filters.hometown) {
      where.hometown = { contains: filters.hometown };
    }

    if (filters.designation) {
      where.currentDesignation = { contains: filters.designation };
    }

    if (filters.chapterId) {
      where.chapterMemberships = {
        some: {
          chapterId: filters.chapterId,
        },
      };
    }

    if (filters.company || filters.industry) {
      where.workExperiences = {
        some: {
          OR: [
            filters.company ? { company: { contains: filters.company } } : {},
            filters.industry ? { description: { contains: filters.industry } } : {},
            filters.industry ? { role: { contains: filters.industry } } : {},
          ].filter(obj => Object.keys(obj).length > 0) as any,
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
  async getAlumniLocations(filters: AlumniLocationFilters = {}) {
    const where: Prisma.UserWhereInput = {
      isActive: true,
      isVerified: true,
      isLocationPublic: true,
      locationLat: { not: null },
      locationLng: { not: null },
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
        where.OR = [
          {
            locationLng: {
              not: null,
              gte: filters.west,
            },
          },
          {
            locationLng: {
              not: null,
              lte: filters.east,
            },
          },
        ];
      }
    }

    const take = Math.min(filters.limit || 1000, 5000);

    const alumni = await prisma.user.findMany({
      where,
      select: {
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
      },
      take,
    });

    return alumni.map(a => ({
      ...a,
      locationLat: a.locationLat?.toNumber(),
      locationLng: a.locationLng?.toNumber(),
    }));
  }

  // Alumni in Bounding Box (Map)
  async getAlumniInBounds(north: number, south: number, east: number, west: number) {
    const alumni = await prisma.user.findMany({
      where: {
        isActive: true,
        isVerified: true,
        isLocationPublic: true,
        locationLat: {
          gte: south,
          lte: north,
        },
        locationLng: {
          gte: west,
          lte: east,
        },
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
      },
    });

    return alumni.map((a) => ({
      ...a,
      locationLat: a.locationLat?.toNumber(),
      locationLng: a.locationLng?.toNumber(),
    }));
  }

  // Alumni Nearby with geospatial filtering
  async getNearbyAlumni(
    centerLat: number,
    centerLng: number,
    radiusKm: number = 50,
    limit: number = 100
  ) {
    // Use raw SQL for spatial query to find nearby users
    // MySQL ST_Distance_Sphere returns distance in meters
    const nearbyUsers = await prisma.$queryRaw<any[]>`
      SELECT 
        id, 
        (ST_Distance_Sphere(point(locationLng, locationLat), point(${centerLng}, ${centerLat})) / 1000) AS distanceKm
      FROM User
      WHERE isActive = 1 
        AND isVerified = 1 
        AND isLocationPublic = 1
        AND locationLat IS NOT NULL 
        AND locationLng IS NOT NULL
        AND ST_Distance_Sphere(point(locationLng, locationLat), point(${centerLng}, ${centerLat})) <= ${radiusKm * 1000}
      ORDER BY distanceKm
      LIMIT ${limit}
    `;

    if (nearbyUsers.length === 0) {
      return {
        count: 0,
        centerLat,
        centerLng,
        radiusKm,
        alumni: [],
      };
    }

    const userIds = nearbyUsers.map(u => u.id);

    // Fetch full user details for the found IDs
    const alumni = await prisma.user.findMany({
      where: {
        id: { in: userIds },
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

    // Combine with distance data and sort by distance
    const nearbyAlumni = nearbyUsers.map(nu => {
      const user = alumni.find(a => a.id === nu.id);
      return {
        ...user,
        locationLat: user?.locationLat?.toNumber(),
        locationLng: user?.locationLng?.toNumber(),
        distanceKm: Math.round(nu.distanceKm * 10) / 10,
      };
    }).filter(a => a.id); // Filter out any null users just in case

    return {
      count: nearbyAlumni.length,
      centerLat,
      centerLng,
      radiusKm,
      alumni: nearbyAlumni,
    };
  }

  // Haversine formula to calculate distance between two coordinates
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
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

  async getNotableAlumni(limit: number = 6) {
    try {
      const notableAlumni = await prisma.user.findMany({
        where: {
          isNotable: true,
          isActive: true,
          isVerified: true,
        },
        select: {
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
        },
        take: limit,
      });

      // If no notable alumni found, return top users by profile completeness as fallback
      if (notableAlumni.length === 0) {
        return prisma.user.findMany({
          where: {
            isActive: true,
            isVerified: true,
            profilePhotoUrl: { not: null },
          },
          select: {
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
          },
          orderBy: [
            { profileCompleteness: 'desc' },
            { createdAt: 'desc' },
          ],
          take: limit,
        });
      }

      return notableAlumni;
    } catch (error) {
      // Fallback for any database errors (like missing columns)
      return prisma.user.findMany({
        where: {
          isActive: true,
          isVerified: true,
          profilePhotoUrl: { not: null },
        },
        select: {
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
        },
        orderBy: [
          { profileCompleteness: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
      });
    }
  }

  async updateProfilePhoto(userId: string, photoUrl: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.profilePhotoUrl) {
      await deleteFromStorage(user.profilePhotoUrl);
    }

    return prisma.user.update({
      where: { id: userId },
      data: { profilePhotoUrl: photoUrl },
    });
  }

  async updateCoverPhoto(userId: string, photoUrl: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.coverPhotoUrl) {
      await deleteFromStorage(user.coverPhotoUrl);
    }

    return prisma.user.update({
      where: { id: userId },
      data: { coverPhotoUrl: photoUrl },
    });
  }
}

export const userService = new UserService();
