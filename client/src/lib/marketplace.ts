import type { MarketplaceListingInput } from '@/lib/api';
import type { MarketplaceListing, MarketplaceListingType } from '@/types';

export const LISTING_TYPES: ReadonlyArray<{ value: MarketplaceListingType; label: string; plural: string; hint: string }> = [
  { value: 'BUSINESS', label: 'Business', plural: 'Businesses', hint: 'A company, shop or practice run by an alum' },
  { value: 'SERVICE', label: 'Service', plural: 'Services', hint: 'Consulting, freelancing or professional help' },
  { value: 'REQUIREMENT', label: 'Requirement', plural: 'Requirements', hint: 'Something you are looking for' },
  { value: 'FOUNDER', label: 'Founder', plural: 'Founders', hint: 'An alum who founded a startup or venture' },
];

export const MARKETPLACE_MAX_IMAGES = 8;

export const listingTypeLabel = (type: string) => LISTING_TYPES.find((t) => t.value === type)?.label ?? type;

/** Mirrors MARKETPLACE_LIMITS in server/src/utils/validators.ts (the server stays authoritative). */
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

export interface ListingFormValues {
  type: MarketplaceListingType;
  title: string;
  category: string;
  description: string;
  location: string;
  website: string;
  contactInfo: string;
  priceRange: string;
  logoUrl: string | null;
  images: string[];
}

export const EMPTY_LISTING_FORM: ListingFormValues = {
  type: 'BUSINESS',
  title: '',
  category: '',
  description: '',
  location: '',
  website: '',
  contactInfo: '',
  priceRange: '',
  logoUrl: null,
  images: [],
};

const OPTIONAL_FIELDS = ['location', 'website', 'contactInfo', 'priceRange'] as const;

export function listingToFormValues(listing: MarketplaceListing): ListingFormValues {
  return {
    type: listing.type ?? 'BUSINESS',
    title: listing.title ?? '',
    category: listing.category ?? '',
    description: listing.description ?? '',
    location: listing.location ?? '',
    website: listing.website ?? '',
    contactInfo: listing.contactInfo ?? '',
    priceRange: listing.priceRange ?? '',
    logoUrl: listing.logoUrl ?? null,
    images: Array.isArray(listing.images) ? listing.images : [],
  };
}

export const isSafeHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value.trim());

export type ListingFormErrors = Partial<Record<keyof ListingFormValues, string>>;

export function validateListingForm(values: ListingFormValues): ListingFormErrors {
  const L = MARKETPLACE_LIMITS;
  const errors: ListingFormErrors = {};
  const title = values.title.trim();
  const category = values.category.trim();
  const description = values.description.trim();

  if (title.length < L.titleMin) errors.title = `Title must be at least ${L.titleMin} characters`;
  else if (title.length > L.titleMax) errors.title = `Title must be at most ${L.titleMax} characters`;

  if (category.length < L.categoryMin) errors.category = 'Category is required';
  else if (category.length > L.categoryMax) errors.category = `Category must be at most ${L.categoryMax} characters`;

  if (description.length < L.descriptionMin) errors.description = `Description must be at least ${L.descriptionMin} characters`;
  else if (description.length > L.descriptionMax) errors.description = `Description must be at most ${L.descriptionMax} characters`;

  const website = values.website.trim();
  if (website && !isSafeHttpUrl(website)) errors.website = 'Website must start with http:// or https://';
  else if (website.length > L.websiteMax) errors.website = `Website must be at most ${L.websiteMax} characters`;

  if (values.location.trim().length > L.locationMax) errors.location = `Location must be at most ${L.locationMax} characters`;
  if (values.contactInfo.trim().length > L.contactInfoMax)
    errors.contactInfo = `Contact info must be at most ${L.contactInfoMax} characters`;
  if (values.priceRange.trim().length > L.priceRangeMax)
    errors.priceRange = `Price range must be at most ${L.priceRangeMax} characters`;

  return errors;
}

/**
 * Request body for POST (create: blank optional fields omitted) or PATCH
 * (edit: blank optional fields sent as null so they are cleared).
 */
export function buildListingPayload(values: ListingFormValues, mode: 'create' | 'edit'): MarketplaceListingInput {
  const payload: MarketplaceListingInput = {
    type: values.type,
    title: values.title.trim(),
    category: values.category.trim(),
    description: values.description.trim(),
  };
  for (const field of OPTIONAL_FIELDS) {
    const value = values[field].trim();
    if (value) payload[field] = value;
    else if (mode === 'edit') payload[field] = null;
  }
  // Media: send images whenever there are any (and always on edit so they can be cleared);
  // send logoUrl when set, or null on edit to clear it.
  if (values.images.length > 0 || mode === 'edit') payload.images = values.images;
  if (values.logoUrl) payload.logoUrl = values.logoUrl;
  else if (mode === 'edit') payload.logoUrl = null;
  return payload;
}
