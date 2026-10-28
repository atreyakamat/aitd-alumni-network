'use client';

import * as React from 'react';
import { ImagePlus, Loader2, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getApiErrorMessage, getApiFieldErrors, marketplaceApi, type MarketplaceListingInput } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import {
  EMPTY_LISTING_FORM,
  LISTING_TYPES,
  MARKETPLACE_LIMITS as L,
  MARKETPLACE_MAX_IMAGES,
  buildListingPayload,
  listingToFormValues,
  validateListingForm,
  type ListingFormValues,
} from '@/lib/marketplace';
import type { MarketplaceListing } from '@/types';

interface ListingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this listing (PATCH); otherwise it creates one (POST). */
  listing?: MarketplaceListing | null;
  /** Existing category names offered as suggestions. */
  categories?: string[];
  /** Receives the payload; reject to keep the dialog open with the error shown. */
  onSubmit: (payload: MarketplaceListingInput) => Promise<unknown>;
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function ListingFormDialog({ open, onOpenChange, listing, categories = [], onSubmit }: ListingFormDialogProps) {
  const isEdit = !!listing;
  const [values, setValues] = React.useState<ListingFormValues>(EMPTY_LISTING_FORM);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const url = await marketplaceApi.uploadImage(file);
      setValues((v) => ({ ...v, logoUrl: url }));
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not upload the logo.'));
    } finally {
      setUploading(false);
    }
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MARKETPLACE_MAX_IMAGES - values.images.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) return;
    setUploading(true);
    setFormError(null);
    try {
      const urls = await Promise.all(picked.map((f) => marketplaceApi.uploadImage(f)));
      setValues((v) => ({ ...v, images: [...v.images, ...urls.filter(Boolean)] }));
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not upload one or more images.'));
    } finally {
      setUploading(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      setValues(listing ? listingToFormValues(listing) : EMPTY_LISTING_FORM);
      setErrors({});
      setFormError(null);
    }
  }, [open, listing]);

  const set =
    (key: keyof ListingFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const clientErrors = validateListingForm(values);
    setErrors(clientErrors as Record<string, string>);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    setSubmitting(true);
    try {
      await onSubmit(buildListingPayload(values, isEdit ? 'edit' : 'create'));
      onOpenChange(false);
    } catch (err) {
      setErrors(getApiFieldErrors(err));
      setFormError(getApiErrorMessage(err, isEdit ? 'Could not save the listing.' : 'Could not publish the listing.'));
    } finally {
      setSubmitting(false);
    }
  };

  const describedBy = (key: string) => (errors[key] ? `listing-${key}-error` : undefined);
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`listing-${key}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  const typeHint = LISTING_TYPES.find((t) => t.value === values.type)?.hint;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit listing' : 'List your business or service'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update the details other alumni see.'
                : 'Share a business or service you run, or post something you are looking for.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="listing-type">Listing type</Label>
            <select id="listing-type" className={selectClass} value={values.type} onChange={set('type')}>
              {LISTING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {typeHint && <p className="text-xs text-muted-foreground">{typeHint}</p>}
            {fieldError('type')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="listing-title">Title</Label>
            <Input
              id="listing-title"
              value={values.title}
              onChange={set('title')}
              maxLength={L.titleMax}
              aria-invalid={!!errors.title}
              aria-describedby={describedBy('title')}
            />
            {fieldError('title')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="listing-category">Category</Label>
            <Input
              id="listing-category"
              value={values.category}
              onChange={set('category')}
              maxLength={L.categoryMax}
              list="listing-category-options"
              placeholder="e.g. Finance, Food, Education"
              aria-invalid={!!errors.category}
              aria-describedby={describedBy('category')}
            />
            <datalist id="listing-category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {fieldError('category')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="listing-description">Description</Label>
            <Textarea
              id="listing-description"
              value={values.description}
              onChange={set('description')}
              rows={5}
              maxLength={L.descriptionMax}
              aria-invalid={!!errors.description}
              aria-describedby={describedBy('description')}
            />
            {fieldError('description')}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="listing-location">Location (optional)</Label>
              <Input
                id="listing-location"
                value={values.location}
                onChange={set('location')}
                maxLength={L.locationMax}
                aria-invalid={!!errors.location}
                aria-describedby={describedBy('location')}
              />
              {fieldError('location')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-price">Price range (optional)</Label>
              <Input
                id="listing-price"
                value={values.priceRange}
                onChange={set('priceRange')}
                maxLength={L.priceRangeMax}
                placeholder="e.g. INR 500-2,000 / hour"
                aria-invalid={!!errors.priceRange}
                aria-describedby={describedBy('priceRange')}
              />
              {fieldError('priceRange')}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="listing-website">Website (optional)</Label>
            <Input
              id="listing-website"
              type="url"
              inputMode="url"
              value={values.website}
              onChange={set('website')}
              maxLength={L.websiteMax}
              placeholder="https://"
              aria-invalid={!!errors.website}
              aria-describedby={describedBy('website')}
            />
            {fieldError('website')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="listing-contact">Contact info (optional)</Label>
            <Input
              id="listing-contact"
              value={values.contactInfo}
              onChange={set('contactInfo')}
              maxLength={L.contactInfoMax}
              placeholder="Email or phone shown to signed-in members"
              aria-invalid={!!errors.contactInfo}
              aria-describedby={describedBy('contactInfo')}
            />
            {fieldError('contactInfo')}
          </div>

          <div className="space-y-2">
            <Label>Logo / headshot (optional)</Label>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                {values.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded asset
                  <img src={mediaSrc(values.logoUrl)} alt="Logo preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground"><ImagePlus className="h-5 w-5" aria-hidden /></div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" asChild disabled={uploading}>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" aria-hidden /> {values.logoUrl ? 'Replace' : 'Upload logo'}
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </Button>
                {values.logoUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setValues((v) => ({ ...v, logoUrl: null }))}>Remove</Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Showcase images (optional, up to {MARKETPLACE_MAX_IMAGES})</Label>
            {values.images.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {values.images.map((url, i) => (
                  <li key={url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset */}
                    <img src={mediaSrc(url)} alt={`Showcase ${i + 1}`} className="h-full w-full object-cover" />
                    <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => setValues((v) => ({ ...v, images: v.images.filter((u) => u !== url) }))} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {values.images.length < MARKETPLACE_MAX_IMAGES && (
              <Button type="button" variant="outline" size="sm" asChild disabled={uploading}>
                <label className="cursor-pointer">
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="mr-2 h-4 w-4" aria-hidden />}
                  Add images
                  <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => { void uploadImages(e.target.files); e.target.value = ''; }} />
                </label>
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || uploading}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? 'Save changes' : 'Publish listing'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
