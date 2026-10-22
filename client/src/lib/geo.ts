import {
  geoApi,
  getApiErrorCode,
  NEARBY_MAX_LIMIT,
  NEARBY_MAX_RADIUS_KM,
  userApi,
  type AlumniMapFilters,
} from '@/lib/api';

/**
 * Alumni map (PRD 6.5 "alumni-nearby"): request building, response normalisation
 * and the small amount of geometry the map page needs. The server rounds member
 * coordinates to 2 decimals (about 1 km) before they ever reach the client.
 */

export type LatLng = [number, number];

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface AlumniPin {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  city: string | null;
  batchYear: number | null;
  department: string | null;
  currentDesignation: string | null;
  company: string | null;
  locationLat: number;
  locationLng: number;
  /** Only present on "near me" results. */
  distanceKm?: number;
}

export interface NearbyResult {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  alumni: AlumniPin[];
}

export interface Place {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
}

/** India-wide view: the default before we know where the viewer is. */
export const DEFAULT_CENTER: LatLng = [20.5937, 78.9629];
export const DEFAULT_ZOOM = 5;
export const PLACE_ZOOM = 11;
export const PIN_ZOOM = 14;

export const RADIUS_OPTIONS_KM = [5, 10, 25, 50, 100, 250] as const;
export const DEFAULT_RADIUS_KM = 25;
/** Most pins one viewport request returns; the map clusters them. */
export const LOCATIONS_LIMIT = 1000;
export const NEARBY_LIMIT = NEARBY_MAX_LIMIT;

export const GEOCODER_UNAVAILABLE = 'GEOCODER_UNAVAILABLE';
export const MIN_PLACE_QUERY = 2;
const SEARCH_MAX = 100;
const MIN_BATCH_YEAR = 1950;
const MAX_BATCH_YEAR = 2100;

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Tile server; override with NEXT_PUBLIC_MAP_TILE_URL / _ATTRIBUTION (e.g. a self-hosted or paid OSM mirror). */
export function mapTileConfig(
  url: string | undefined = process.env.NEXT_PUBLIC_MAP_TILE_URL,
  attribution: string | undefined = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION
): { url: string; attribution: string } {
  const customUrl = url?.trim();
  if (!customUrl) return { url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
  return { url: customUrl, attribution: attribution?.trim() || OSM_ATTRIBUTION };
}

// ---------------------------------------------------------------------------
// Coordinates & bounds
// ---------------------------------------------------------------------------

export const isValidLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Longitude folded into [-180, 180] (Leaflet reports e.g. 190 after panning east past the antimeridian). */
export function wrapLongitude(lng: number): number {
  if (lng >= -180 && lng <= 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

const clampLat = (lat: number) => Math.min(90, Math.max(-90, lat));

/**
 * Viewport bounds as the server expects them: latitudes clamped, longitudes wrapped
 * into [-180, 180] (so `west > east` marks a view across the antimeridian), and the
 * whole world when the view spans 360° or more. Rounded to 4 decimals so tiny pans
 * do not trigger new requests.
 */
export function normalizeBounds(bounds: MapBounds): MapBounds {
  const north = round(clampLat(Math.max(bounds.north, bounds.south)), 4);
  const south = round(clampLat(Math.min(bounds.north, bounds.south)), 4);
  if (!Number.isFinite(bounds.east) || !Number.isFinite(bounds.west) || bounds.east - bounds.west >= 360) {
    return { north, south, east: 180, west: -180 };
  }
  return {
    north,
    south,
    east: round(wrapLongitude(bounds.east), 4),
    west: round(wrapLongitude(bounds.west), 4),
  };
}

export const boundsEqual = (a: MapBounds | null, b: MapBounds | null): boolean =>
  !!a && !!b && a.north === b.north && a.south === b.south && a.east === b.east && a.west === b.west;

/** Great-circle distance in km (used for the viewer's own marker and as a fallback). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "< 1 km", "3.4 km", "12 km"; empty string for anything unusable. */
export function formatDistance(km: unknown): string {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return '';
  if (km < 1) return '< 1 km';
  if (km < 10) return `${round(km, 1)} km`;
  return `${Math.round(km)} km`;
}

export const clampRadius = (km: number): number =>
  Number.isFinite(km) ? Math.min(Math.max(km, 1), NEARBY_MAX_RADIUS_KM) : DEFAULT_RADIUS_KM;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface MapFilterInput {
  batchYear?: string | number | null;
  department?: string | null;
  search?: string | null;
}

/** Only well-formed, non-empty filters reach the server. */
export function buildFilterParams(input: MapFilterInput): AlumniMapFilters {
  const out: AlumniMapFilters = {};
  const year = typeof input.batchYear === 'number' ? input.batchYear : Number(String(input.batchYear ?? '').trim());
  if (input.batchYear !== '' && input.batchYear !== null && Number.isInteger(year) && year >= MIN_BATCH_YEAR && year <= MAX_BATCH_YEAR) {
    out.batchYear = year;
  }
  const department = input.department?.trim();
  if (department && department.toLowerCase() !== 'all') out.department = department;
  const search = input.search?.trim().replace(/\s+/g, ' ');
  if (search) out.search = search.slice(0, SEARCH_MAX);
  return out;
}

// ---------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Pins from either map endpoint: drops rows without an id or usable coordinates
 * (including the 0,0 "null island" placeholder), coerces Decimal strings, de-dupes.
 */
export function normalizeAlumniPins(rows: unknown): AlumniPin[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const pins: AlumniPin[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : null;
    const lat = toFiniteNumber(r.locationLat);
    const lng = toFiniteNumber(r.locationLng);
    if (!id || seen.has(id) || lat === null || lng === null || !isValidLatLng(lat, lng)) continue;
    if (lat === 0 && lng === 0) continue;
    seen.add(id);

    const firstJob = Array.isArray(r.workExperiences) ? (r.workExperiences[0] as Record<string, unknown> | undefined) : undefined;
    const distance = toFiniteNumber(r.distanceKm);
    pins.push({
      id,
      fullName: optionalString(r.fullName) ?? 'Alumni member',
      profilePhotoUrl: optionalString(r.profilePhotoUrl),
      city: optionalString(r.city),
      batchYear: toFiniteNumber(r.batchYear),
      department: optionalString(r.department),
      currentDesignation: optionalString(r.currentDesignation),
      company: optionalString(r.company) ?? optionalString(firstJob?.company),
      locationLat: lat,
      locationLng: lng,
      ...(distance !== null ? { distanceKm: distance } : {}),
    });
  }
  return pins;
}

export function normalizeNearby(data: unknown, fallback: { lat: number; lng: number; radiusKm: number }): NearbyResult {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const alumni = normalizeAlumniPins(d.alumni);
  // Keep the server's distance order; sort defensively when it is missing.
  if (alumni.every((a) => typeof a.distanceKm === 'number')) {
    alumni.sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number));
  }
  return {
    centerLat: toFiniteNumber(d.centerLat) ?? fallback.lat,
    centerLng: toFiniteNumber(d.centerLng) ?? fallback.lng,
    radiusKm: toFiniteNumber(d.radiusKm) ?? fallback.radiusKm,
    alumni,
  };
}

const toPlace = (value: unknown): Place | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const lat = toFiniteNumber(v.lat);
  const lng = toFiniteNumber(v.lng);
  const label = optionalString(v.label);
  if (lat === null || lng === null || !label || !isValidLatLng(lat, lng)) return null;
  return { label, lat, lng, city: optionalString(v.city) };
};

export function normalizePlaces(data: unknown): Place[] {
  return Array.isArray(data) ? data.map(toPlace).filter((p): p is Place => p !== null) : [];
}

export const normalizePlace = (data: unknown): Place | null => toPlace(data);

/** True when place search/reverse geocoding is switched off or its upstream is down. */
export function isGeocoderUnavailable(err: unknown): boolean {
  return getApiErrorCode(err) === GEOCODER_UNAVAILABLE || (err as any)?.response?.status === 503;
}

export const isAbortError = (err: unknown): boolean => {
  const e = err as any;
  return e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED';
};

// ---------------------------------------------------------------------------
// API wrappers (normalised)
// ---------------------------------------------------------------------------

export async function fetchAlumniInBounds(
  bounds: MapBounds,
  filters: AlumniMapFilters = {},
  signal?: AbortSignal
): Promise<AlumniPin[]> {
  const response = await userApi.getLocations({ ...bounds, limit: LOCATIONS_LIMIT, ...filters }, { signal });
  return normalizeAlumniPins(response.data?.data);
}

export async function fetchNearbyAlumni(
  center: { lat: number; lng: number },
  radiusKm: number,
  filters: AlumniMapFilters = {},
  signal?: AbortSignal
): Promise<NearbyResult> {
  const radius = clampRadius(radiusKm);
  const response = await userApi.getNearby(center.lat, center.lng, radius, NEARBY_LIMIT, { filters, signal });
  return normalizeNearby(response.data?.data, { lat: center.lat, lng: center.lng, radiusKm: radius });
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < MIN_PLACE_QUERY) return [];
  const response = await geoApi.search(q.slice(0, SEARCH_MAX), 5, { signal });
  return normalizePlaces(response.data?.data);
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<Place | null> {
  const response = await geoApi.reverse(lat, lng, { signal });
  return normalizePlace(response.data?.data);
}
