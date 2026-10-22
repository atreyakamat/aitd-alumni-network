import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { Actor, isAdminRole } from '../config/permissions';
import { MarketplaceListingType, Prisma } from '@prisma/client';

interface CreateListingInput {
  type?: MarketplaceListingType;
  title: string;
  category: string;
  description: string;
  location?: string | null;
  website?: string | null;
  contactInfo?: string | null;
  priceRange?: string | null;
}

interface ListingFilters {
  type?: MarketplaceListingType;
  category?: string;
  location?: string;
  search?: string;
  page?: number;
  limit?: number;
}

const MAX_SEARCH_LENGTH = 100;
const cleanFilter = (value: unknown, max = MAX_SEARCH_LENGTH): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
};

const LISTING_TYPES: MarketplaceListingType[] = Object.values(MarketplaceListingType) as MarketplaceListingType[];
const OWNER_EDITABLE_FIELDS = [
  'type', 'title', 'category', 'description', 'location', 'website', 'contactInfo', 'priceRange', 'isActive',
] as const;
const ADMIN_EDITABLE_FIELDS = [...OWNER_EDITABLE_FIELDS, 'isFeatured'] as const;

const assertListingType = (type: unknown): MarketplaceListingType | undefined => {
  if (type === undefined || type === null || type === '') return undefined;
  if (!LISTING_TYPES.includes(type as MarketplaceListingType)) {
    throw new AppError('Invalid listing type', 400, 'VALIDATION_ERROR');
  }
  return type as MarketplaceListingType;
};

const assertWebsite = (website: unknown) => {
  if (website === undefined || website === null || website === '') return;
  if (typeof website !== 'string' || !/^https?:\/\/[^\s]+$/i.test(website.trim())) {
    throw new AppError('Website must be an http(s) URL', 400, 'VALIDATION_ERROR');
  }
};

const requireText = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${label} is required`, 400, 'VALIDATION_ERROR');
  }
};

export class MarketplaceService {
  async getListings(filters: ListingFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.MarketplaceListingWhereInput = {
      isActive: true,
    };

    const type = assertListingType(filters.type);
    if (type) {
      where.type = type;
    }

    // Category browsing uses the exact names returned by getCategories()
    const category = cleanFilter(filters.category);
    if (category) {
      where.category = category;
    }

    const location = cleanFilter(filters.location);
    if (location) {
      where.location = ilike(location);
    }

    const search = cleanFilter(filters.search);
    if (search) {
      where.OR = [
        { title: ilike(search) },
        { description: ilike(search) },
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

  /**
   * Listing detail. Inactive listings are visible only to their owner and admins.
   * Owner views do not inflate the view counter.
   */
  async getListing(id: string, viewer?: Actor | null) {
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

    const isOwner = !!viewer && viewer.id === listing.userId;
    const isAdmin = !!viewer && isAdminRole(viewer.userRole);

    if (!listing.isActive && !isOwner && !isAdmin) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }

    if (isOwner) {
      return listing;
    }

    await prisma.marketplaceListing.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return { ...listing, viewCount: (listing.viewCount ?? 0) + 1 };
  }

  async createListing(userId: string, data: CreateListingInput) {
    requireText(data?.title, 'Title');
    requireText(data.category, 'Category');
    requireText(data.description, 'Description');
    const type = assertListingType(data.type) || 'BUSINESS';
    assertWebsite(data.website);

    return prisma.marketplaceListing.create({
      data: {
        userId,
        type,
        title: data.title.trim(),
        category: data.category.trim(),
        description: data.description,
        location: data.location,
        website: data.website,
        contactInfo: data.contactInfo,
        priceRange: data.priceRange,
      },
    });
  }

  /** Owner (or platform admin) update. Only whitelisted fields are applied; isFeatured is admin-only. */
  async updateListing(actor: Actor, id: string, data: Partial<CreateListingInput> & { isActive?: boolean; isFeatured?: boolean }) {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }

    const isAdmin = isAdminRole(actor.userRole);
    if (listing.userId !== actor.id && !isAdmin) {
      throw new AppError('Not authorized to update this listing', 403, 'FORBIDDEN');
    }

    const fields: readonly string[] = isAdmin ? ADMIN_EDITABLE_FIELDS : OWNER_EDITABLE_FIELDS;
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      const value = (data as Record<string, unknown> | undefined)?.[field];
      if (value !== undefined) updates[field] = value;
    }

    if (updates.type !== undefined) assertListingType(updates.type);
    if (updates.title !== undefined) requireText(updates.title, 'Title');
    if (updates.category !== undefined) requireText(updates.category, 'Category');
    if (updates.description !== undefined) requireText(updates.description, 'Description');
    if (updates.website !== undefined) assertWebsite(updates.website);
    if (updates.isActive !== undefined) updates.isActive = updates.isActive === true || updates.isActive === 'true';
    if (updates.isFeatured !== undefined) updates.isFeatured = updates.isFeatured === true || updates.isFeatured === 'true';

    return prisma.marketplaceListing.update({
      where: { id },
      data: updates as Prisma.MarketplaceListingUpdateInput,
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
      where: { isActive: true },
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
    const listing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!listing) {
      throw new AppError('Listing not found', 404, 'NOT_FOUND');
    }
    return prisma.marketplaceListing.update({
      where: { id },
      data: { isFeatured: featured },
    });
  }
}

export const marketplaceService = new MarketplaceService();
