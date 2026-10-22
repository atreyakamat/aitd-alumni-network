import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '' },
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock('axios', () => {
  const create = vi.fn(() => mockInstance);
  return { default: { create, post: vi.fn() }, create };
});

import { galleryApi, marketplaceApi } from '@/lib/api';
import {
  EMPTY_LISTING_FORM,
  buildListingPayload,
  isSafeHttpUrl,
  listingToFormValues,
  listingTypeLabel,
  validateListingForm,
  type ListingFormValues,
} from '@/lib/marketplace';
import type { MarketplaceListing } from '@/types';

beforeEach(() => {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    mockInstance[method].mockReset();
    mockInstance[method].mockResolvedValue({ data: { success: true, data: {} } });
  }
});

const valid: ListingFormValues = {
  ...EMPTY_LISTING_FORM,
  type: 'SERVICE',
  title: '  Tax filing help ',
  category: ' Finance ',
  description: '  Personal and small-business tax filing by an alum CA.  ',
};

describe('marketplaceApi', () => {
  it('sends only the filters that are set', async () => {
    await marketplaceApi.getListings({ page: 1, limit: 12, type: undefined, category: '', search: undefined });
    expect(mockInstance.get).toHaveBeenCalledWith('/marketplace', { params: { page: 1, limit: 12 } });

    await marketplaceApi.getListings({ page: 2, limit: 12, type: 'SERVICE', category: 'Finance', search: 'tax' });
    expect(mockInstance.get).toHaveBeenLastCalledWith('/marketplace', {
      params: { page: 2, limit: 12, type: 'SERVICE', category: 'Finance', search: 'tax' },
    });
  });

  it('uses the listing lifecycle endpoints and encodes ids', async () => {
    await marketplaceApi.getListing('a/b');
    expect(mockInstance.get).toHaveBeenCalledWith('/marketplace/a%2Fb');
    await marketplaceApi.getMyListings();
    expect(mockInstance.get).toHaveBeenLastCalledWith('/marketplace/my');
    await marketplaceApi.getCategories();
    expect(mockInstance.get).toHaveBeenLastCalledWith('/marketplace/categories');
    await marketplaceApi.createListing({ title: 'Cafe', category: 'Food', description: 'x'.repeat(20) });
    expect(mockInstance.post).toHaveBeenCalledWith('/marketplace', { title: 'Cafe', category: 'Food', description: 'x'.repeat(20) });
    await marketplaceApi.updateListing('l1', { isActive: false });
    expect(mockInstance.patch).toHaveBeenCalledWith('/marketplace/l1', { isActive: false });
    await marketplaceApi.deleteListing('l1');
    expect(mockInstance.delete).toHaveBeenCalledWith('/marketplace/l1');
  });
});

describe('galleryApi.getAlbums', () => {
  it('passes the search term and drops empty params', async () => {
    await galleryApi.getAlbums(2, 12, undefined, 'reunion');
    expect(mockInstance.get).toHaveBeenCalledWith('/gallery/albums', { params: { page: 2, limit: 12, search: 'reunion' } });
    await galleryApi.getAlbums(1, 12, undefined, '');
    expect(mockInstance.get).toHaveBeenLastCalledWith('/gallery/albums', { params: { page: 1, limit: 12 } });
  });
});

describe('validateListingForm', () => {
  it('accepts a valid listing', () => {
    expect(validateListingForm(valid)).toEqual({});
  });

  it('mirrors the server rules', () => {
    const errors = validateListingForm({
      ...EMPTY_LISTING_FORM,
      title: ' ab ',
      category: '',
      description: 'too short',
      website: 'javascript:alert(1)',
      contactInfo: 'x'.repeat(201),
      priceRange: 'x'.repeat(101),
    });
    expect(errors).toEqual({
      title: 'Title must be at least 3 characters',
      category: 'Category is required',
      description: 'Description must be at least 20 characters',
      website: 'Website must start with http:// or https://',
      contactInfo: 'Contact info must be at most 200 characters',
      priceRange: 'Price range must be at most 100 characters',
    });
  });
});

describe('buildListingPayload', () => {
  it('trims fields and omits blank optional fields when creating', () => {
    expect(buildListingPayload({ ...valid, location: '  ', website: ' https://tax.example.com ' }, 'create')).toEqual({
      type: 'SERVICE',
      title: 'Tax filing help',
      category: 'Finance',
      description: 'Personal and small-business tax filing by an alum CA.',
      website: 'https://tax.example.com',
    });
  });

  it('sends null for cleared optional fields when editing', () => {
    expect(buildListingPayload({ ...valid, contactInfo: 'call me', priceRange: '' }, 'edit')).toEqual({
      type: 'SERVICE',
      title: 'Tax filing help',
      category: 'Finance',
      description: 'Personal and small-business tax filing by an alum CA.',
      location: null,
      website: null,
      contactInfo: 'call me',
      priceRange: null,
    });
  });
});

describe('helpers', () => {
  it('maps a listing to form values', () => {
    const listing = {
      id: 'l1',
      userId: 'u1',
      type: 'BUSINESS',
      title: 'Cafe',
      category: 'Food',
      description: 'd',
      location: null,
      website: 'https://cafe.example',
      contactInfo: undefined,
      priceRange: 'INR 200',
    } as unknown as MarketplaceListing;
    expect(listingToFormValues(listing)).toEqual({
      type: 'BUSINESS',
      title: 'Cafe',
      category: 'Food',
      description: 'd',
      location: '',
      website: 'https://cafe.example',
      contactInfo: '',
      priceRange: 'INR 200',
    });
  });

  it('only treats http(s) URLs as safe links', () => {
    expect(isSafeHttpUrl('https://x.example')).toBe(true);
    expect(isSafeHttpUrl('http://x.example/path')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('ftp://x')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });

  it('labels listing types', () => {
    expect(listingTypeLabel('REQUIREMENT')).toBe('Requirement');
    expect(listingTypeLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});
