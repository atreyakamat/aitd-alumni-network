'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Compass, Loader2, LocateFixed, MapPin, Navigation, RefreshCw, Search, Users } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { getApiErrorMessage, userApi } from '@/lib/api';
import { geolocationErrorMessage, profileQueryKey, type EditableProfile } from '@/lib/profile';
import {
  boundsEqual,
  buildFilterParams,
  DEFAULT_CENTER,
  DEFAULT_RADIUS_KM,
  DEFAULT_ZOOM,
  fetchAlumniInBounds,
  fetchNearbyAlumni,
  formatDistance,
  isAbortError,
  isGeocoderUnavailable,
  isValidLatLng,
  LOCATIONS_LIMIT,
  MIN_PLACE_QUERY,
  NEARBY_LIMIT,
  normalizeBounds,
  PLACE_ZOOM,
  RADIUS_OPTIONS_KM,
  searchPlaces,
  type AlumniPin,
  type LatLng,
  type MapBounds,
  type Place,
} from '@/lib/geo';
import { getInitials } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { MapView } from '@/components/map/AlumniMap';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

// Leaflet touches `window` on import, so the map only renders in the browser.
const AlumniMap = dynamic(() => import('@/components/map/AlumniMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[55vh] min-h-[320px] items-center justify-center rounded-lg border bg-muted lg:h-[calc(100vh-16rem)] lg:min-h-[480px]">
      <div className="text-center">
        <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading interactive map...</p>
      </div>
    </div>
  ),
});

type Mode = 'explore' | 'nearby';

const SAVED_LOCATION_LABEL = 'your saved profile location';

interface SearchCentre {
  lat: number;
  lng: number;
  label: string;
}

const DEPARTMENTS = [
  'Computer Science',
  'Computer Engineering',
  'Information Technology',
  'Electronics',
  'Electrical',
  'Mechanical',
  'Civil',
];

const CURRENT_YEAR = new Date().getFullYear();
const BATCH_YEARS = Array.from({ length: CURRENT_YEAR + 4 - 1980 + 1 }, (_, i) => CURRENT_YEAR + 4 - i);

const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 };

export default function AlumniNearbyPage() {
  const { user } = useAuth();
  const { data: myProfile } = useQuery({
    queryKey: profileQueryKey(user?.id),
    queryFn: async () => (await userApi.getProfile(user!.id)).data.data as EditableProfile,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const savedLocation = useMemo<LatLng | null>(() => {
    const lat = Number(myProfile?.locationLat);
    const lng = Number(myProfile?.locationLng);
    return myProfile?.locationLat != null && myProfile?.locationLng != null && isValidLatLng(lat, lng) ? [lat, lng] : null;
  }, [myProfile?.locationLat, myProfile?.locationLng]);
  const isSharingLocation = Boolean(myProfile?.isLocationPublic && savedLocation);

  // Map view & mode
  const [mode, setMode] = useState<Mode>('explore');
  const [view, setView] = useState<MapView>({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, key: 0 });
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [nearbyCentre, setNearbyCentre] = useState<SearchCentre | null>(null);
  const hasCentred = useRef(false);

  // Geolocation
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Filters (server-side)
  const [nameQuery, setNameQuery] = useState('');
  const [batchYear, setBatchYear] = useState('');
  const [department, setDepartment] = useState('');
  const debouncedName = useDebouncedValue(nameQuery, 350);
  const filters = useMemo(
    () => buildFilterParams({ search: debouncedName, batchYear, department }),
    [debouncedName, batchYear, department]
  );
  const hasFilters = Object.keys(filters).length > 0;

  // Results
  const [alumni, setAlumni] = useState<AlumniPin[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  // Place search
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [geocoderDown, setGeocoderDown] = useState(false);
  const placeRequest = useRef<AbortController | null>(null);

  const recentre = useCallback((center: LatLng, zoom: number) => {
    hasCentred.current = true;
    setView((previous) => ({ center, zoom, key: previous.key + 1 }));
  }, []);

  // Start where the member said they live, unless something already moved the map.
  useEffect(() => {
    if (savedLocation && !hasCentred.current) recentre(savedLocation, PLACE_ZOOM);
  }, [savedLocation, recentre]);

  const savedLocationRef = useRef(savedLocation);
  savedLocationRef.current = savedLocation;

  const locate = useCallback(
    (purpose: 'centre' | 'nearby', { silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setGeoError(null);
      const fallBackToSaved = () => {
        const saved = savedLocationRef.current;
        if (purpose === 'nearby' && saved) {
          setNearbyCentre((current) => current ?? { lat: saved[0], lng: saved[1], label: SAVED_LOCATION_LABEL });
        }
      };
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        if (!silent) setGeoError('Your browser does not support location detection.');
        fallBackToSaved();
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const here: LatLng = [position.coords.latitude, position.coords.longitude];
          setLocating(false);
          setGeoError(null);
          setUserLocation(here);
          if (purpose === 'nearby') {
            hasCentred.current = true;
            setNearbyCentre({ lat: here[0], lng: here[1], label: 'your current location' });
          } else {
            recentre(here, 12);
          }
        },
        (error) => {
          setLocating(false);
          if (!silent) setGeoError(geolocationErrorMessage(error));
          fallBackToSaved();
        },
        GEO_OPTIONS
      );
    },
    [recentre]
  );

  // Only locate on load when the browser already granted access: no surprise permission prompt.
  useEffect(() => {
    let cancelled = false;
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!permissions?.query) return;
    permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((state) => {
        if (!cancelled && state.state === 'granted') locate('centre', { silent: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const handleBoundsChange = useCallback((next: MapBounds) => {
    const normalized = normalizeBounds(next);
    setBounds((previous) => (boundsEqual(previous, normalized) ? previous : normalized));
  }, []);

  // Fetch pins: viewport in "explore", radius around a centre in "near me". Stale requests are aborted.
  useEffect(() => {
    if (mode === 'explore' && !bounds) return;
    if (mode === 'nearby' && !nearbyCentre) {
      setAlumni([]);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setStatus('loading');
        setLoadError(null);
        try {
          const pins =
            mode === 'explore'
              ? await fetchAlumniInBounds(bounds!, filters, controller.signal)
              : (await fetchNearbyAlumni(nearbyCentre!, radiusKm, filters, controller.signal)).alumni;
          if (controller.signal.aborted) return;
          setAlumni(pins);
          setStatus('success');
        } catch (err) {
          if (controller.signal.aborted || isAbortError(err)) return;
          setLoadError(getApiErrorMessage(err, 'Could not load alumni for the map.'));
          setStatus('error');
        }
      },
      mode === 'explore' ? 250 : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, bounds, nearbyCentre, radiusKm, filters, retryToken]);

  useEffect(() => () => placeRequest.current?.abort(), []);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setSelectedId(null);
    if (next === 'nearby' && !nearbyCentre) {
      if (userLocation) {
        setNearbyCentre({ lat: userLocation[0], lng: userLocation[1], label: 'your current location' });
      } else {
        locate('nearby');
      }
    }
  };

  const runPlaceSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = placeQuery.trim();
    if (q.length < MIN_PLACE_QUERY) {
      setPlaceError(`Type at least ${MIN_PLACE_QUERY} characters.`);
      return;
    }
    placeRequest.current?.abort();
    const controller = new AbortController();
    placeRequest.current = controller;
    setPlaceLoading(true);
    setPlaceError(null);
    try {
      const results = await searchPlaces(q, controller.signal);
      if (controller.signal.aborted) return;
      setPlaces(results);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      if (isGeocoderUnavailable(err)) {
        setGeocoderDown(true);
        setPlaces(null);
      } else {
        setPlaceError(getApiErrorMessage(err, 'Place search failed. Try again.'));
      }
    } finally {
      if (!controller.signal.aborted) setPlaceLoading(false);
    }
  };

  const pickPlace = (place: Place) => {
    setPlaces(null);
    setPlaceQuery(place.label);
    setSelectedId(null);
    if (mode === 'nearby') {
      hasCentred.current = true;
      setNearbyCentre({ lat: place.lat, lng: place.lng, label: place.city ?? place.label });
    } else {
      recentre([place.lat, place.lng], PLACE_ZOOM);
    }
  };

  const focusAlumnus = (alumnus: AlumniPin) => {
    setSelectedId(alumnus.id);
    setFocusToken((token) => token + 1);
  };

  const clearFilters = () => {
    setNameQuery('');
    setBatchYear('');
    setDepartment('');
  };

  const radius = useMemo(
    () => (mode === 'nearby' && nearbyCentre ? { center: [nearbyCentre.lat, nearbyCentre.lng] as LatLng, km: radiusKm } : null),
    [mode, nearbyCentre, radiusKm]
  );

  const geoHint =
    mode === 'nearby' && nearbyCentre?.label === SAVED_LOCATION_LABEL
      ? 'Showing alumni near your saved profile location instead.'
      : geocoderDown
        ? 'Pan and zoom the map to explore instead.'
        : 'You can search for a place instead.';

  const loading = status === 'loading';
  const limitReached = mode === 'explore' ? alumni.length >= LOCATIONS_LIMIT : alumni.length >= NEARBY_LIMIT;
  const summary =
    mode === 'nearby'
      ? nearbyCentre
        ? `${alumni.length} ${alumni.length === 1 ? 'alumnus' : 'alumni'} within ${radiusKm} km of ${nearbyCentre.label}`
        : 'Choose a centre to search around'
      : `${alumni.length} ${alumni.length === 1 ? 'alumnus' : 'alumni'} in this area`;

  return (
    <div className="container mx-auto px-4 py-6 md:py-8">
      <div className="mb-6">
        <h1 className="mb-2 font-headline text-3xl font-bold text-primary">Alumni Nearby</h1>
        <p className="text-muted-foreground">Discover alumni around you or anywhere in the world.</p>
      </div>

      {myProfile && !isSharingLocation && (
        <Alert className="mb-6" data-testid="share-location-banner">
          <MapPin className="h-4 w-4" aria-hidden />
          <AlertTitle>You are not on the map yet</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Share an approximate location (about 1 km) so nearby alumni can find you.</span>
            <Link href="/profile/edit#privacy" className="font-medium text-primary underline-offset-4 hover:underline">
              Update my location
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Map mode" className="inline-flex rounded-md border p-1">
              <Button
                type="button"
                size="sm"
                variant={mode === 'explore' ? 'default' : 'ghost'}
                aria-pressed={mode === 'explore'}
                onClick={() => switchMode('explore')}
              >
                <Compass className="mr-2 h-4 w-4" aria-hidden />
                Explore map
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'nearby' ? 'default' : 'ghost'}
                aria-pressed={mode === 'nearby'}
                onClick={() => switchMode('nearby')}
              >
                <Navigation className="mr-2 h-4 w-4" aria-hidden />
                Near me
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {mode === 'nearby' && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="radius" className="whitespace-nowrap text-sm">
                    Radius
                  </Label>
                  <select
                    id="radius"
                    className={`${selectClassName} w-28`}
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                  >
                    {RADIUS_OPTIONS_KM.map((km) => (
                      <option key={km} value={km}>
                        {km} km
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => locate(mode === 'nearby' ? 'nearby' : 'centre')}
                disabled={locating}
              >
                {locating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="mr-2 h-4 w-4" aria-hidden />
                )}
                {locating ? 'Locating...' : 'Use my location'}
              </Button>
            </div>
          </div>

          {geoError && (
            <Alert variant="destructive" data-testid="geo-error">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertDescription>
                {geoError} {geoHint}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <form onSubmit={runPlaceSearch} className="space-y-1 lg:col-span-2" role="search" aria-label="Find a place">
              <Label htmlFor="place-search">Go to a place</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="place-search"
                    placeholder={geocoderDown ? 'Place search is unavailable' : 'City, area or landmark'}
                    value={placeQuery}
                    onChange={(e) => {
                      setPlaceQuery(e.target.value);
                      setPlaceError(null);
                    }}
                    disabled={geocoderDown}
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={geocoderDown || placeLoading}>
                  {placeLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Go'}
                </Button>
              </div>
              {geocoderDown && (
                <p className="text-xs text-muted-foreground" data-testid="geocoder-down">
                  Place search is unavailable right now. Pan and zoom the map instead.
                </p>
              )}
              {placeError && (
                <p className="text-xs text-destructive" role="alert">
                  {placeError}
                </p>
              )}
              {places && (
                <ul className="mt-1 divide-y rounded-md border bg-background text-sm" aria-label="Matching places">
                  {places.length === 0 ? (
                    <li className="px-3 py-2 text-muted-foreground">No matching places found.</li>
                  ) : (
                    places.map((place) => (
                      <li key={`${place.lat},${place.lng},${place.label}`}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => pickPlace(place)}
                        >
                          {place.label}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </form>

            <div className="space-y-1">
              <Label htmlFor="batch-filter">Batch</Label>
              <select
                id="batch-filter"
                className={selectClassName}
                value={batchYear}
                onChange={(e) => setBatchYear(e.target.value)}
              >
                <option value="">All batches</option>
                {BATCH_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-filter">Department</Label>
              <select
                id="department-filter"
                className={selectClassName}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-1">
          <Card className="flex max-h-[70vh] flex-col">
            <CardHeader className="space-y-3 border-b pb-3">
              <CardTitle className="flex items-center gap-2 text-base" aria-live="polite">
                <Users className="h-5 w-5 shrink-0" aria-hidden />
                <span data-testid="result-summary">{summary}</span>
                {loading && alumni.length > 0 && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Updating" />
                )}
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  aria-label="Search alumni by name"
                  placeholder="Search by name..."
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {limitReached && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {alumni.length}. {mode === 'explore' ? 'Zoom in' : 'Narrow the radius'} to see everyone.
                </p>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {status === 'error' ? (
                <div className="space-y-3 p-4 text-center" role="alert">
                  <p className="text-sm text-destructive">{loadError}</p>
                  <Button size="sm" variant="outline" onClick={() => setRetryToken((t) => t + 1)}>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                    Retry
                  </Button>
                </div>
              ) : mode === 'nearby' && !nearbyCentre ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {locating
                    ? 'Finding your location...'
                    : 'Use your location or search for a place to find alumni nearby.'}
                </p>
              ) : (loading || status === 'idle') && alumni.length === 0 ? (
                <div className="space-y-3 p-4" data-testid="results-loading">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : alumni.length === 0 ? (
                <div className="space-y-2 px-4 py-8 text-center text-sm text-muted-foreground">
                  <p>
                    {mode === 'nearby'
                      ? 'No alumni found in this radius. Try a larger radius.'
                      : 'No alumni in this area. Zoom out or move the map.'}
                  </p>
                  {hasFilters && (
                    <Button size="sm" variant="ghost" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-border" aria-label="Alumni on the map">
                  {alumni.map((alumnus) => {
                    const distance = formatDistance(alumnus.distanceKm);
                    return (
                      <li key={alumnus.id}>
                        <button
                          type="button"
                          onClick={() => focusAlumnus(alumnus)}
                          aria-pressed={selectedId === alumnus.id}
                          className={`flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none ${
                            selectedId === alumnus.id ? 'border-l-2 border-primary bg-muted' : ''
                          }`}
                        >
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={alumnus.profilePhotoUrl || undefined} alt="" />
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {getInitials(alumnus.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{alumnus.fullName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[alumnus.city, alumnus.batchYear ? `Batch ${alumnus.batchYear}` : null]
                                .filter(Boolean)
                                .join(' • ')}
                            </p>
                          </div>
                          {distance && (
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">{distance}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-3">
          <AlumniMap
            alumni={alumni}
            view={view}
            selectedId={selectedId}
            focusToken={focusToken}
            onMarkerClick={(alumnus) => setSelectedId(alumnus.id)}
            onBoundsChange={handleBoundsChange}
            userLocation={userLocation}
            radius={radius}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Only alumni who chose to share their location appear, and pins are approximate (about 1 km).
          </p>
        </div>
      </div>
    </div>
  );
}
