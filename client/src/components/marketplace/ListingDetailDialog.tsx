'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Eye, ExternalLink, MapPin, MessageSquare, Pencil, Phone, Star, Tag, Trash2, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage, marketplaceApi } from '@/lib/api';
import { isSafeHttpUrl, listingTypeLabel } from '@/lib/marketplace';
import { formatDate, getInitials } from '@/lib/utils';
import type { MarketplaceListing } from '@/types';

interface ListingDetailDialogProps {
  listingId: string | null;
  currentUserId?: string;
  onClose: () => void;
  /** Shown only to the listing's owner. */
  onEdit: (listing: MarketplaceListing) => void;
  /** Admin moderation of other members' listings: feature/unfeature and remove (never edit their words). */
  canModerate?: boolean;
  onToggleFeatured?: (listing: MarketplaceListing) => void;
  onRemove?: (listing: MarketplaceListing) => void;
}

export function ListingDetailDialog({
  listingId,
  currentUserId,
  onClose,
  onEdit,
  canModerate = false,
  onToggleFeatured,
  onRemove,
}: ListingDetailDialogProps) {
  const { data: listing, isLoading, isError, error } = useQuery({
    queryKey: ['marketplace', 'listing', listingId],
    queryFn: async () => (await marketplaceApi.getListing(listingId as string)).data.data as MarketplaceListing,
    enabled: !!listingId,
  });

  const isOwner = !!listing && !!currentUserId && listing.userId === currentUserId;
  const owner = listing?.user;

  return (
    <Dialog open={!!listingId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading listing">
            <DialogHeader>
              <DialogTitle className="sr-only">Loading listing</DialogTitle>
            </DialogHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError || !listing ? (
          <>
            <DialogHeader>
              <DialogTitle>Listing unavailable</DialogTitle>
            </DialogHeader>
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {getApiErrorMessage(error, 'Could not load this listing.')}
            </p>
          </>
        ) : (
          <div className="space-y-5">
            <DialogHeader>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{listingTypeLabel(listing.type)}</Badge>
                <Badge variant="outline">
                  <Tag className="h-3 w-3 mr-1" aria-hidden="true" />
                  {listing.category}
                </Badge>
                {listing.isFeatured && <Badge>Featured</Badge>}
                {!listing.isActive && <Badge variant="destructive">Paused</Badge>}
              </div>
              <DialogTitle className="text-xl">{listing.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Listed {formatDate(listing.createdAt)}</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  {listing.viewCount ?? 0} views
                </span>
              </DialogDescription>
            </DialogHeader>

            <p className="whitespace-pre-line text-sm leading-relaxed">{listing.description}</p>

            <dl className="grid gap-3 text-sm">
              {listing.priceRange && (
                <div className="flex items-start gap-2">
                  <Wallet className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="sr-only">Price range</dt>
                  <dd>{listing.priceRange}</dd>
                </div>
              )}
              {listing.location && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="sr-only">Location</dt>
                  <dd>{listing.location}</dd>
                </div>
              )}
              {listing.contactInfo && (
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="sr-only">Contact</dt>
                  <dd className="break-all">{listing.contactInfo}</dd>
                </div>
              )}
            </dl>

            {owner && (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={owner.profilePhotoUrl || undefined} alt="" />
                  <AvatarFallback>{getInitials(owner.fullName || '')}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Link href={`/profile/${encodeURIComponent(owner.id)}`} className="font-medium hover:underline">
                    {owner.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {[owner.currentDesignation, owner.batchYear ? `Batch of ${owner.batchYear}` : null, owner.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <Button onClick={() => onEdit(listing)}>
                  <Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
                  Edit listing
                </Button>
              ) : (
                <Button asChild>
                  <Link href={`/messages?u=${encodeURIComponent(listing.userId)}`}>
                    <MessageSquare className="h-4 w-4 mr-2" aria-hidden="true" />
                    Message {owner?.fullName?.split(' ')[0] || 'owner'}
                  </Link>
                </Button>
              )}
              {isSafeHttpUrl(listing.website) && (
                <Button variant="outline" asChild>
                  <a href={listing.website.trim()} target="_blank" rel="noopener noreferrer nofollow">
                    <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
                    Visit website
                  </a>
                </Button>
              )}
            </div>

            {canModerate && !isOwner && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Moderation</span>
                {onToggleFeatured && (
                  <Button variant="outline" size="sm" onClick={() => onToggleFeatured(listing)}>
                    <Star className="h-4 w-4 mr-2" aria-hidden="true" />
                    {listing.isFeatured ? 'Unfeature' : 'Feature'}
                  </Button>
                )}
                {onRemove && (
                  <Button variant="destructive" size="sm" onClick={() => onRemove(listing)}>
                    <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    Remove listing
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
