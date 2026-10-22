'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Briefcase,
  Eye,
  MapPin,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Store,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react';
import { getApiErrorMessage, marketplaceApi, readPaginated, type MarketplaceListingInput } from '@/lib/api';
import { LISTING_TYPES, listingTypeLabel } from '@/lib/marketplace';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDate, getInitials } from '@/lib/utils';
import { ListingFormDialog } from '@/components/marketplace/ListingFormDialog';
import { ListingDetailDialog } from '@/components/marketplace/ListingDetailDialog';
import { DeleteListingDialog } from '@/components/marketplace/DeleteListingDialog';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MarketplaceCategory, MarketplaceListing, MarketplaceListingType } from '@/types';
import { isAdmin } from '@/lib/roles';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 100;

function ListingGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6" role="status" aria-label="Loading listings">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i}>
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
        <span>{getApiErrorMessage(error, 'Failed to load the marketplace. Please try again.')}</span>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      aria-pressed={active}
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

function ListingCard({ listing, onOpen }: { listing: MarketplaceListing; onOpen: () => void }) {
  const owner = listing.user;
  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardContent className="p-5 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{listingTypeLabel(listing.type)}</Badge>
          <Badge variant="outline">
            <Tag className="h-3 w-3 mr-1" aria-hidden="true" />
            {listing.category}
          </Badge>
          {listing.isFeatured && <Badge>Featured</Badge>}
        </div>
        <h3 className="font-semibold text-lg leading-snug line-clamp-2">{listing.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-3">{listing.description}</p>
        <div className="space-y-1 text-sm text-muted-foreground">
          {listing.priceRange && (
            <p className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{listing.priceRange}</span>
            </p>
          )}
          {listing.location && (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{listing.location}</span>
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="p-5 pt-0 flex items-center justify-between gap-3">
        {owner ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7">
              <AvatarImage src={owner.profilePhotoUrl || undefined} alt="" />
              <AvatarFallback className="text-xs">{getInitials(owner.fullName || '')}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground truncate">
              {owner.fullName}
              {owner.batchYear ? ` · ${owner.batchYear}` : ''}
            </span>
          </div>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" onClick={onOpen} aria-label={`View details: ${listing.title}`}>
          View details
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function MarketplacePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('browse');
  const [searchInput, setSearchInput] = useState('');
  const [type, setType] = useState<MarketplaceListingType | ''>('');
  const [category, setCategory] = useState('');
  const search = useDebouncedValue(searchInput.trim().slice(0, SEARCH_MAX_LENGTH), SEARCH_DEBOUNCE_MS);

  // The page belongs to one filter combination: changing a filter starts again at page 1.
  const filterKey = JSON.stringify([type, category, search]);
  const [pager, setPager] = useState({ key: filterKey, page: 1 });
  const page = pager.key === filterKey ? pager.page : 1;
  const setPage = (next: number) => setPager({ key: filterKey, page: next });

  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MarketplaceListing | null>(null);
  const [deleting, setDeleting] = useState<MarketplaceListing | null>(null);

  const listingsQuery = useQuery({
    queryKey: ['marketplace', 'list', { type, category, search, page }],
    queryFn: async () =>
      (
        await marketplaceApi.getListings({
          page,
          limit: PAGE_SIZE,
          type: type || undefined,
          category: category || undefined,
          search: search || undefined,
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: async () => ((await marketplaceApi.getCategories()).data?.data ?? []) as MarketplaceCategory[],
  });

  const myListingsQuery = useQuery({
    queryKey: ['marketplace', 'my'],
    queryFn: async () => ((await marketplaceApi.getMyListings()).data?.data ?? []) as MarketplaceListing[],
    enabled: tab === 'mine' && !!user,
  });

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['marketplace'] });

  const toggleActive = useMutation({
    mutationFn: (listing: MarketplaceListing) => marketplaceApi.updateListing(listing.id, { isActive: !listing.isActive }),
    onSuccess: (_res, listing) => {
      toast({ title: listing.isActive ? 'Listing paused' : 'Listing resumed' });
      refreshAll();
    },
    onError: (err) =>
      toast({ title: 'Could not update the listing', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' }),
  });

  const canModerate = isAdmin(user);
  const toggleFeatured = useMutation({
    mutationFn: (listing: MarketplaceListing) => marketplaceApi.updateListing(listing.id, { isFeatured: !listing.isFeatured }),
    onSuccess: (_res, listing) => {
      toast({ title: listing.isFeatured ? 'Listing unfeatured' : 'Listing featured' });
      refreshAll();
    },
    onError: (err) =>
      toast({ title: 'Could not update the listing', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' }),
  });
  const openRemove = (listing: MarketplaceListing) => {
    setDetailId(null);
    setDeleting(listing);
  };

  const { items: listings, totalPages } = readPaginated<MarketplaceListing>(listingsQuery.data);
  const categories = categoriesQuery.data ?? [];
  const hasFilters = !!(type || category || search);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (listing: MarketplaceListing) => {
    setDetailId(null);
    setEditing(listing);
    setFormOpen(true);
  };

  const submitListing = async (payload: MarketplaceListingInput) => {
    if (editing) {
      await marketplaceApi.updateListing(editing.id, payload);
      toast({ title: 'Listing updated' });
    } else {
      await marketplaceApi.createListing(payload);
      toast({ title: 'Listing published', description: 'Other alumni can now find it in the marketplace.' });
    }
    refreshAll();
  };

  const deleteListing = async (listing: MarketplaceListing) => {
    await marketplaceApi.deleteListing(listing.id);
    toast({ title: 'Listing deleted' });
    refreshAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Alumni Marketplace</h1>
          <p className="text-muted-foreground">Discover businesses and services run by fellow alumni, or post what you need.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          List your business or service
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="mine">My listings</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  aria-label="Search listings"
                  placeholder="Search businesses, services and requirements..."
                  className="pl-9"
                  value={searchInput}
                  maxLength={SEARCH_MAX_LENGTH}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Listing type">
                <FilterButton active={!type} onClick={() => setType('')}>
                  All types
                </FilterButton>
                {LISTING_TYPES.map((t) => (
                  <FilterButton key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
                    {t.plural}
                  </FilterButton>
                ))}
              </div>
              {categories.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
                  <FilterButton active={!category} onClick={() => setCategory('')}>
                    All categories
                  </FilterButton>
                  {categories.map((c) => (
                    <FilterButton key={c.name} active={category === c.name} onClick={() => setCategory(c.name)}>
                      {c.name}
                      <span className="ml-1.5 text-xs opacity-70">{c.count}</span>
                    </FilterButton>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {listingsQuery.isLoading ? (
            <ListingGridSkeleton />
          ) : listingsQuery.isError ? (
            <ErrorState error={listingsQuery.error} onRetry={() => listingsQuery.refetch()} retrying={listingsQuery.isFetching} />
          ) : listings.length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed rounded-xl">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" aria-hidden="true" />
              <h3 className="text-lg font-medium">No listings found</h3>
              <p className="text-muted-foreground mt-1">
                {hasFilters ? 'Try adjusting your search or filters.' : 'Be the first to list your business or service.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} onOpen={() => setDetailId(listing.id)} />
              ))}
            </div>
          )}

          {!listingsQuery.isLoading && !listingsQuery.isError && totalPages > 1 && (
            <nav className="flex justify-center items-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" aria-label="Previous page" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
                Previous
              </Button>
              <span className="px-4 text-sm font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Next page"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </nav>
          )}
        </TabsContent>

        <TabsContent value="mine" className="space-y-4">
          {myListingsQuery.isLoading ? (
            <ListingGridSkeleton />
          ) : myListingsQuery.isError ? (
            <ErrorState error={myListingsQuery.error} onRetry={() => myListingsQuery.refetch()} retrying={myListingsQuery.isFetching} />
          ) : (myListingsQuery.data ?? []).length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed rounded-xl">
              <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" aria-hidden="true" />
              <h3 className="text-lg font-medium">You haven&apos;t listed anything yet</h3>
              <p className="text-muted-foreground mt-1 mb-4">List a business, a service you offer, or something you need.</p>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                Create a listing
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {(myListingsQuery.data ?? []).map((listing) => (
                <Card key={listing.id}>
                  <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={listing.isActive ? 'success' : 'warning'}>{listing.isActive ? 'Active' : 'Paused'}</Badge>
                        <Badge variant="secondary">{listingTypeLabel(listing.type)}</Badge>
                        <Badge variant="outline">{listing.category}</Badge>
                        {listing.isFeatured && <Badge>Featured</Badge>}
                      </div>
                      <h3 className="font-semibold text-lg truncate">{listing.title}</h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-3">
                        <span>Listed {formatDate(listing.createdAt)}</span>
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          {listing.viewCount ?? 0} views
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDetailId(listing.id)} aria-label={`View ${listing.title}`}>
                        View
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(listing)} aria-label={`Edit ${listing.title}`}>
                        <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActive.mutate(listing)}
                        disabled={toggleActive.isPending && toggleActive.variables?.id === listing.id}
                        aria-label={`${listing.isActive ? 'Pause' : 'Resume'} ${listing.title}`}
                      >
                        {listing.isActive ? (
                          <Pause className="h-4 w-4 mr-1" aria-hidden="true" />
                        ) : (
                          <Play className="h-4 w-4 mr-1" aria-hidden="true" />
                        )}
                        {listing.isActive ? 'Pause' : 'Resume'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(listing)}
                        aria-label={`Delete ${listing.title}`}
                      >
                        <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ListingDetailDialog
        listingId={detailId}
        currentUserId={user?.id}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
        canModerate={canModerate}
        onToggleFeatured={(listing) => toggleFeatured.mutate(listing)}
        onRemove={openRemove}
      />
      <ListingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        listing={editing}
        categories={categories.map((c) => c.name)}
        onSubmit={submitListing}
      />
      <DeleteListingDialog listing={deleting} onClose={() => setDeleting(null)} onConfirm={deleteListing} />
    </div>
  );
}
