import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { MarketplaceListingType, Prisma } from '@prisma/client';

interface CreateListingInput {
  type?: MarketplaceListingType;
  title: string;
  category: string;
  description: string;
  location?: string;
  website?: string;
  contactInfo?: string;
  priceRange?: string;
}

interface ListingFilters {
  type?: MarketplaceListingType;
  category?: string;
  location?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class MarketplaceService {
  async getListings(filters: ListingFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.MarketplaceListingWhereInput = {
      isActive: true,
    };

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.category) {
      where.category = { contains: filters.category };
    }

    if (filters.location) {
      where.location = { contains: filters.location };
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search } },
        { description: { contains: filters.search } },
      ];
    }

    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              batchYear: true,
              membershipTier: {
                select: { name: true, badgeColor: true },
              },
            },
          },
        },
        orderBy: [
          { isFeatured: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take,
      }),
      prisma.marketplaceListing.count({ where }),
    ]);

    return buildPaginationResponse(listings, total, page, limit);
  }

  async getListing(id: string) {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            batchYear: true,
            city: true,
            currentDesignation: true,
            membershipTier: {
              select: { name: true, badgeColor: true },
            },
          },
        },
      },
    });

    if (!listing) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }

    // Increment view count
    await prisma.marketplaceListing.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return listing;
  }

  async createListing(userId: string, data: CreateListingInput) {
    return prisma.marketplaceListing.create({
      data: {
        userId,
        type: data.type || 'BUSINESS',
        title: data.title,
        category: data.category,
        description: data.description,
        location: data.location,
        website: data.website,
        contactInfo: data.contactInfo,
        priceRange: data.priceRange,
      },
    });
  }

  async updateListing(userId: string, id: string, data: Partial<CreateListingInput>) {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }

    if (listing.userId !== userId) {
      throw new AppError('Not authorized to update this listing', 403, 'FORBIDDEN');
    }

    return prisma.marketplaceListing.update({
      where: { id },
      data,
    });
  }

  async deleteListing(userId: string, id: string, isAdmin: boolean = false) {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }

    if (listing.userId !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this listing', 403, 'FORBIDDEN');
    }

    await prisma.marketplaceListing.delete({ where: { id } });
    return { message: 'Listing deleted' };
  }

  async getMyListings(userId: string) {
    return prisma.marketplaceListing.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCategories() {
    const categories = await prisma.marketplaceListing.groupBy({
      by: ['category'],
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    });

    return categories.map(c => ({
      name: c.category,
      count: c._count.category,
    }));
  }

  // Admin: Feature a listing
  async featureListing(id: string, featured: boolean) {
    return prisma.marketplaceListing.update({
      where: { id },
      data: { isFeatured: featured },
    });
  }
}

export const marketplaceService = new MarketplaceService();
