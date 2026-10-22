/**
 * Place search and reverse geocoding for the alumni map, proxied through the API so that
 *  - browsers never call the geocoder directly (one identifying User-Agent, no CORS issues),
 *  - results are cached (Nominatim asks clients to cache), and
 *  - upstream calls are spaced out (the public Nominatim allows 1 request/second).
 *
 * Defaults to OpenStreetMap Nominatim; point GEOCODER_URL at a self-hosted Nominatim (or any
 * API-compatible service) for heavier traffic, or set GEOCODER_URL=off to disable it. When
 * disabled or unreachable the endpoints answer 503 GEOCODER_UNAVAILABLE and the map keeps
 * working without place search.
 */
import config from '../config';
import { AppError } from '../middleware/errorHandler';

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
}

export interface GeocodingOptions {
  /** Base URL of a Nominatim-compatible API; empty disables geocoding. */
  baseUrl: string;
  userAgent: string;
  /** Contact address forwarded to Nominatim (recommended by its usage policy). */
  email: string;
  minIntervalMs: number;
  timeoutMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const GEOCODE_MAX_QUERY_LENGTH = 200;
export const GEOCODE_MAX_RESULTS = 10;
const GEOCODE_DEFAULT_RESULTS = 5;
/** Reverse lookups are cached per ~1 km cell, matching the precision the map stores. */
const REVERSE_CACHE_DECIMALS = 2;

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string | undefined>;
  error?: string;
}

const unavailable = () =>
  new AppError('Place search is unavailable right now. Try again later.', 503, 'GEOCODER_UNAVAILABLE');

const cityOf = (address: NominatimPlace['address']): string | null =>
  address?.city ?? address?.town ?? address?.village ?? address?.municipality ?? address?.county ?? null;

const toResult = (place: NominatimPlace): GeocodeResult | null => {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { label: place.display_name ?? '', lat, lng, city: cityOf(place.address) };
};

export class GeocodingService {
  private readonly options: Required<GeocodingOptions>;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  /** Serialises upstream calls so the minimum interval holds under concurrency. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = Number.NEGATIVE_INFINITY;

  constructor(options: GeocodingOptions) {
    this.options = {
      fetch: (...args) => fetch(...args),
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
    };
  }

  get enabled(): boolean {
    return this.options.baseUrl !== '';
  }

  async search(query: string, limit: number = GEOCODE_DEFAULT_RESULTS): Promise<GeocodeResult[]> {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q || q.length > GEOCODE_MAX_QUERY_LENGTH) {
      throw new AppError(`q must be 1-${GEOCODE_MAX_QUERY_LENGTH} characters`, 400, 'VALIDATION_ERROR');
    }
    const take = Math.min(GEOCODE_MAX_RESULTS, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : GEOCODE_DEFAULT_RESULTS)));

    return this.cached(`search:${take}:${q.toLowerCase()}`, async () => {
      const places = await this.request<NominatimPlace[]>('/search', { q, limit: String(take) });
      return (Array.isArray(places) ? places : []).map(toResult).filter((r): r is GeocodeResult => r !== null);
    });
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new AppError('lat must be within [-90, 90] and lng within [-180, 180]', 400, 'VALIDATION_ERROR');
    }
    const key = `reverse:${lat.toFixed(REVERSE_CACHE_DECIMALS)},${lng.toFixed(REVERSE_CACHE_DECIMALS)}`;

    return this.cached(key, async () => {
      // zoom=10 resolves to city level, which is all the profile needs
      const place = await this.request<NominatimPlace>('/reverse', { lat: String(lat), lon: String(lng), zoom: '10' });
      return place && !place.error ? toResult(place) : null;
    });
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.options.now()) {
      // Refresh recency so the map behaves as an LRU
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.value as T;
    }

    const value = await load();
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: this.options.now() + this.options.cacheTtlMs });
    while (this.cache.size > this.options.cacheMaxEntries) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return value;
  }

  private request<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.enabled) return Promise.reject(unavailable());

    const run = async (): Promise<T> => {
      const wait = this.lastCallAt + this.options.minIntervalMs - this.options.now();
      if (wait > 0) await this.options.sleep(wait);
      this.lastCallAt = this.options.now();

      const url = new URL(`${this.options.baseUrl}${path}`);
      url.search = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        'accept-language': 'en',
        ...(this.options.email ? { email: this.options.email } : {}),
        ...params,
      }).toString();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const res = await this.options.fetch(url.toString(), {
          headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
          signal: controller.signal,
        } as RequestInit);
        if (!res.ok) throw unavailable();
        return (await res.json()) as T;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw unavailable();
      } finally {
        clearTimeout(timer);
      }
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export const geocodingService = new GeocodingService({
  baseUrl: config.geocoder.url,
  userAgent: config.geocoder.userAgent,
  email: config.geocoder.email,
  minIntervalMs: config.geocoder.minIntervalMs,
  timeoutMs: config.geocoder.timeoutMs,
  cacheTtlMs: config.geocoder.cacheTtlSeconds * 1000,
  cacheMaxEntries: 2000,
});
