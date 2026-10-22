import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';

const userApi = vi.hoisted(() => ({ getLocations: vi.fn(), getNearby: vi.fn() }));
const geoApi = vi.hoisted(() => ({ search: vi.fn(), reverse: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
  geoApi,
}));

import {
  boundsEqual,
  buildFilterParams,
  clampRadius,
  DEFAULT_RADIUS_KM,
  fetchAlumniInBounds,
  fetchNearbyAlumni,
  formatDistance,
  haversineKm,
  isAbortError,
  isGeocoderUnavailable,
  LOCATIONS_LIMIT,
  mapTileConfig,
  normalizeAlumniPins,
  normalizeBounds,
  normalizeNearby,
  normalizePlaces,
  reverseGeocode,
  searchPlaces,
  wrapLongitude,
} from '@/lib/geo';

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Ada Alum',
  profilePhotoUrl: null,
  city: 'Panaji',
  batchYear: 2015,
  department: 'Computer Science',
  currentDesignation: 'Engineer',
  locationLat: 15.49,
  locationLng: 73.82,
  ...over,
});

beforeEach(() => {
  userApi.getLocations.mockReset();
  userApi.getNearby.mockReset();
  geoApi.search.mockReset();
  geoApi.reverse.mockReset();
});

describe('wrapLongitude / normalizeBounds', () => {
  it('leaves in-range longitudes alone and folds the rest into [-180, 180]', () => {
    expect(wrapLongitude(73.8)).toBe(73.8);
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(540)).toBe(-180);
  });

  it('rounds to 4 decimals and orders north/south', () => {
    expect(normalizeBounds({ north: 10.123456, south: 20.98765, east: 80.55555, west: 70.11111 })).toEqual({
      north: 20.9877,
      south: 10.1235,
      east: 80.5556,
      west: 70.1111,
    });
  });

  it('keeps west > east for a view across the antimeridian', () => {
    expect(normalizeBounds({ north: 10, south: -10, east: 190, west: 170 })).toEqual({
      north: 10,
      south: -10,
      east: -170,
      west: 170,
    });
  });

  it('returns the whole world for views spanning 360° or more and clamps latitude', () => {
    expect(normalizeBounds({ north: 95, south: -100, east: 400, west: -400 })).toEqual({
      north: 90,
      south: -90,
      east: 180,
      west: -180,
    });
  });

  it('compares bounds by value', () => {
    const a = { north: 1, south: 0, east: 1, west: 0 };
    expect(boundsEqual(a, { ...a })).toBe(true);
    expect(boundsEqual(a, { ...a, east: 2 })).toBe(false);
    expect(boundsEqual(null, a)).toBe(false);
  });
});

describe('distances', () => {
  it('computes great-circle distance', () => {
    // Mumbai → Pune is about 120 km.
    expect(haversineKm([19.076, 72.8777], [18.5204, 73.8567])).toBeGreaterThan(115);
    expect(haversineKm([19.076, 72.8777], [18.5204, 73.8567])).toBeLessThan(125);
    expect(haversineKm([10, 10], [10, 10])).toBe(0);
  });

  it('formats distances for the list', () => {
    expect(formatDistance(0.4)).toBe('< 1 km');
    expect(formatDistance(3.44)).toBe('3.4 km');
    expect(formatDistance(12.6)).toBe('13 km');
    expect(formatDistance(undefined)).toBe('');
    expect(formatDistance(Number.NaN)).toBe('');
    expect(formatDistance(-1)).toBe('');
  });

  it('clamps the radius to what the server accepts', () => {
    expect(clampRadius(2000)).toBe(500);
    expect(clampRadius(0)).toBe(1);
    expect(clampRadius(Number.NaN)).toBe(DEFAULT_RADIUS_KM);
    expect(clampRadius(25)).toBe(25);
  });
});

describe('buildFilterParams', () => {
  it('sends only well-formed filters', () => {
    expect(buildFilterParams({ batchYear: '2015', department: ' Civil ', search: '  ada   lovelace ' })).toEqual({
      batchYear: 2015,
      department: 'Civil',
      search: 'ada lovelace',
    });
  });

  it('drops empty, "all" and out-of-range values', () => {
    expect(buildFilterParams({ batchYear: '', department: 'all', search: '   ' })).toEqual({});
    expect(buildFilterParams({ batchYear: 'abc' })).toEqual({});
    expect(buildFilterParams({ batchYear: 1800 })).toEqual({});
    expect(buildFilterParams({ batchYear: null, department: null, search: null })).toEqual({});
  });

  it('caps the search length', () => {
    expect(buildFilterParams({ search: 'x'.repeat(250) }).search).toHaveLength(100);
  });
});

describe('normalizeAlumniPins', () => {
  it('coerces Decimal strings and maps the current company', () => {
    const [pin] = normalizeAlumniPins([
      row({ locationLat: '15.49', locationLng: '73.82', workExperiences: [{ company: 'Acme' }] }),
    ]);
    expect(pin).toMatchObject({ id: 'u1', locationLat: 15.49, locationLng: 73.82, company: 'Acme' });
    expect(pin).not.toHaveProperty('distanceKm');
  });

  it('drops rows without an id or usable coordinates and de-dupes', () => {
    const pins = normalizeAlumniPins([
      row(),
      row(), // duplicate id
      row({ id: 'u2', locationLat: null }),
      row({ id: 'u3', locationLat: 0, locationLng: 0 }),
      row({ id: 'u4', locationLat: 95 }),
      row({ id: 'u5', locationLng: 'abc' }),
      row({ id: undefined }),
      null,
      'nope',
      row({ id: 'u6', fullName: '', city: '  ', distanceKm: '2.5' }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(['u1', 'u6']);
    expect(pins[1]).toMatchObject({ fullName: 'Alumni member', city: null, distanceKm: 2.5 });
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeAlumniPins(undefined)).toEqual([]);
    expect(normalizeAlumniPins({ alumni: [] })).toEqual([]);
  });
});

describe('normalizeNearby', () => {
  it('sorts by distance and falls back to the requested centre', () => {
    const result = normalizeNearby(
      { alumni: [row({ id: 'far', distanceKm: 9 }), row({ id: 'near', distanceKm: 1 })] },
      { lat: 1, lng: 2, radiusKm: 25 }
    );
    expect(result.alumni.map((a) => a.id)).toEqual(['near', 'far']);
    expect(result).toMatchObject({ centerLat: 1, centerLng: 2, radiusKm: 25 });
  });

  it('copes with an empty body', () => {
    expect(normalizeNearby(null, { lat: 1, lng: 2, radiusKm: 5 })).toEqual({
      centerLat: 1,
      centerLng: 2,
      radiusKm: 5,
      alumni: [],
    });
  });
});

describe('places', () => {
  it('keeps only valid places', () => {
    expect(
      normalizePlaces([
        { label: 'Panaji, Goa, India', lat: '15.4909', lng: 73.8278, city: 'Panaji' },
        { label: '', lat: 1, lng: 1 },
        { label: 'Bad', lat: 200, lng: 1 },
        null,
      ])
    ).toEqual([{ label: 'Panaji, Goa, India', lat: 15.4909, lng: 73.8278, city: 'Panaji' }]);
    expect(normalizePlaces('x')).toEqual([]);
  });

  it('recognises an unavailable geocoder', () => {
    const err = new AxiosError('down', 'ERR_BAD_RESPONSE', undefined, null, {
      status: 503,
      statusText: '',
      headers: {},
      config: {} as any,
      data: { success: false, error: { code: 'GEOCODER_UNAVAILABLE', message: 'down' } },
    });
    expect(isGeocoderUnavailable(err)).toBe(true);
    expect(isGeocoderUnavailable(new Error('network'))).toBe(false);
  });

  it('recognises aborted requests', () => {
    expect(isAbortError({ name: 'CanceledError' })).toBe(true);
    expect(isAbortError({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });
});

describe('mapTileConfig', () => {
  it('defaults to OpenStreetMap', () => {
    expect(mapTileConfig('', undefined)).toEqual({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: expect.stringContaining('OpenStreetMap'),
    });
  });

  it('uses a configured tile server, keeping OSM attribution unless overridden', () => {
    expect(mapTileConfig('https://tiles.example.com/{z}/{x}/{y}.png', ' ')).toEqual({
      url: 'https://tiles.example.com/{z}/{x}/{y}.png',
      attribution: expect.stringContaining('OpenStreetMap'),
    });
    expect(mapTileConfig('https://t/{z}/{x}/{y}.png', '© Example').attribution).toBe('© Example');
  });
});

describe('API wrappers', () => {
  it('fetches viewport pins with filters and a signal', async () => {
    userApi.getLocations.mockReturnValue(ok([row(), row({ id: 'u2', locationLat: null })]));
    const controller = new AbortController();
    const bounds = { north: 20, south: 10, east: 80, west: 70 };

    const pins = await fetchAlumniInBounds(bounds, { batchYear: 2015 }, controller.signal);

    expect(userApi.getLocations).toHaveBeenCalledWith(
      { ...bounds, limit: LOCATIONS_LIMIT, batchYear: 2015 },
      { signal: controller.signal }
    );
    expect(pins.map((p) => p.id)).toEqual(['u1']);
  });

  it('fetches nearby alumni with a clamped radius', async () => {
    userApi.getNearby.mockReturnValue(ok({ centerLat: 15.5, centerLng: 73.8, radiusKm: 500, alumni: [row({ distanceKm: 3 })] }));
    const result = await fetchNearbyAlumni({ lat: 15.5, lng: 73.8 }, 9000, { department: 'Civil' });
    expect(userApi.getNearby).toHaveBeenCalledWith(15.5, 73.8, 500, 200, { filters: { department: 'Civil' }, signal: undefined });
    expect(result.alumni[0].distanceKm).toBe(3);
    expect(result.radiusKm).toBe(500);
  });

  it('skips place search for very short queries', async () => {
    expect(await searchPlaces(' a ')).toEqual([]);
    expect(geoApi.search).not.toHaveBeenCalled();
  });

  it('searches and reverse-geocodes places', async () => {
    geoApi.search.mockReturnValue(ok([{ label: 'Pune, India', lat: 18.52, lng: 73.86, city: 'Pune' }]));
    geoApi.reverse.mockReturnValue(ok({ label: 'Pune, India', lat: 18.52, lng: 73.86, city: 'Pune' }));

    expect(await searchPlaces(' Pune ')).toEqual([{ label: 'Pune, India', lat: 18.52, lng: 73.86, city: 'Pune' }]);
    expect(geoApi.search).toHaveBeenCalledWith('Pune', 5, { signal: undefined });
    expect(await reverseGeocode(18.52, 73.86)).toMatchObject({ city: 'Pune' });

    geoApi.reverse.mockReturnValue(ok(null));
    expect(await reverseGeocode(0, 0)).toBeNull();
  });
});
